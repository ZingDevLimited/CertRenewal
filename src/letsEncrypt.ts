import * as acme from "acme-client";
import * as cp from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pauseAsync, runCmdAsync } from "./common";

// tslint:disable-next-line: no-var-requires
const ci = require("cert-info");

type CertType = "pem" | "pfx";
type LetsEncryptMode = "staging" | "production";

interface ILetsEncryptGenerateCertParams {
    certType: CertType;
    dnsResourceGroupName: string;
    dnsSubscriptionId: string;
    domain: string;
    letsEncryptMode: LetsEncryptMode;
    notifyEmail: string;
    subDomain: string;
}

interface ICert {
    cert: string;
    privateKey: string;
    expiryDateEpochMs: number;
}

export const GenerateCertAsync = async (inputs: ILetsEncryptGenerateCertParams): Promise<ICert> => {
    let directoryUrl: string;
    switch (inputs.letsEncryptMode) {
        case "staging":
            directoryUrl = acme.directory.letsencrypt.staging;
            break;
        case "production":
            directoryUrl = acme.directory.letsencrypt.production;
            break;
        default:
            throw new Error(`invalid input. unsupported letsEncryptMode ${inputs.letsEncryptMode}`);
    }

    const client = new acme.Client({
        accountKey: await acme.forge.createPrivateKey(),
        directoryUrl,
    });

    await client.createAccount({
        contact: [`mailto: ${inputs.notifyEmail}`],
        termsOfServiceAgreed: true,
    });

    const identifiers: acme.Identifier[] = [];
    let cnName: string;
    if (inputs.subDomain) {
        identifiers.push({ type: "dns", value: `${inputs.subDomain}.${inputs.domain}` });
        cnName = `${inputs.subDomain}.${inputs.domain}`;
    } else {
        // root, no subdomain
        identifiers.push({ type: "dns", value: inputs.domain });
        cnName = inputs.domain;
    }

    if (inputs.subDomain === "*") {
        // for wildcard, include root
        identifiers.push({ type: "dns", value: inputs.domain });
    }
    const order = await client.createOrder({
        identifiers,
    });

    let recordSetName: string = "_acme-challenge";
    if (inputs.subDomain && inputs.subDomain !== "*") {
        recordSetName += `.${inputs.subDomain}`;
    }

    let cmd = "az network dns record-set txt create";
    cmd += ` --subscription ${inputs.dnsSubscriptionId}`;
    cmd += ` --resource-group ${inputs.dnsResourceGroupName}`;
    cmd += ` --zone-name ${inputs.domain}`;
    cmd += ` --name ${recordSetName}`;
    cmd += " --ttl 20";
    const ctrsr = await runCmdAsync(cmd);
    if (!ctrsr.success) {
        throw new Error(`failed to create txt record set: (${ctrsr.exitCode}) - ${ctrsr.errorMessage}`);
    }

    const authorisations = await client.getAuthorizations(order);
    for (let i = 0, l = authorisations.length; i < l; i++) {
        const challenge = authorisations[i].challenges.find((e) => e.type === "dns-01");
        if (!challenge) {
            throw new Error("failed to find dns challenge for authorisation");
        }
        const dnsValue = await client.getChallengeKeyAuthorization(challenge);
        let recordCmd = "az network dns record-set txt add-record";
        recordCmd += ` --subscription ${inputs.dnsSubscriptionId}`;
        recordCmd += ` --resource-group ${inputs.dnsResourceGroupName}`;
        recordCmd += ` --zone-name ${inputs.domain}`;
        recordCmd += ` --record-set-name ${recordSetName}`;
        recordCmd += ` --value "${dnsValue}"`;
        const addRecordResult = await runCmdAsync(recordCmd);
        if (!addRecordResult.success) {
            throw new Error("failed to set DNS TXT record for challenge");
        }
        await pauseAsync(30);
        await client.verifyChallenge(authorisations[i], challenge);
        await client.completeChallenge(challenge);
        await client.waitForValidStatus(challenge);

        recordCmd = recordCmd.replace("add-record", "remove-record");
        recordCmd += " --keep-empty-record-set";
        const removeRecordResult = await runCmdAsync(recordCmd);
        if (!removeRecordResult.success) {
            throw new Error(`failed to remove DNS TXT record for challenge. (${removeRecordResult.exitCode}) - ${removeRecordResult.errorMessage}`);
        }
    }

    const [key, csr] = await acme.forge.createCsr({
        altNames: inputs.subDomain === "*" ? [inputs.domain] : undefined,
        commonName: cnName,
    });
    await client.finalizeOrder(order, csr);
    const cert = await client.getCertificate(order);

    // cleanup
    cmd = "az network dns record-set txt delete";
    cmd += ` --subscription ${inputs.dnsSubscriptionId}`;
    cmd += ` --resource-group ${inputs.dnsResourceGroupName}`;
    cmd += ` --zone-name ${inputs.domain}`;
    cmd += ` --name ${recordSetName}`;
    cmd += " --yes";
    const dtrsr = await runCmdAsync(cmd);
    if (!dtrsr.success) {
        console.warn(`failed to delete txt record set: (${ctrsr.exitCode}) - ${ctrsr.errorMessage}`);
    }

    switch (inputs.certType) {
        case "pem":
            return {
                cert,
                expiryDateEpochMs: getExpiryEpochInMs(cert, cnName),
                privateKey: key.toString(),
            };
        case "pfx":
            return await convertToPfxAsync(key.toString(), cert, "data", cnName);
        default:
            throw new Error(`unexpected value for input parameter typeToGenerate. value was: ${inputs.certType}`);
    }
};

const getExpiryEpochInMs = (pem: string, subject: string) => {
    let expiresAt: number = 0;
    const split = pem.split("\r\n\r\n");
    for (let i = 0, l = split.length; i < l; i++) {
        const info = ci.info(split[i]);
        if (info.subject === subject) {
            expiresAt = info.expiresAt;
        }
    }
    return expiresAt;
};

const convertToPfxAsync = (
    pemKey: string,
    pemCert: string,
    mode: "file" | "data",
    cnName: string): Promise<ICert> => {
    return new Promise((resolve) => {
        if (mode !== "data" && mode !== "file") {
            throw new Error(`invalid argument, unsupported mode: ${mode}`);
        }

        fs.mkdtemp(path.join(os.tmpdir(), "convertCert-"), (mkdtempErr, folder) => {
            if (mkdtempErr) {
                throw new Error(`failed to create temp directory. (${mkdtempErr.code}) - ${mkdtempErr.message}`);
            }

            const pemKeyPath: string = mode === "file" ? pemKey : path.join(folder, "pem.key");
            const pemCertPath: string = mode === "file" ? pemCert : path.join(folder, "pem.cert");
            const pfxPath: string = path.join(folder, "out.pfx");
            let expiryDateEpochMs: number;
            if (mode === "data") {
                fs.writeFileSync(pemKeyPath, pemKey);
                fs.writeFileSync(pemCertPath, pemCert);
                expiryDateEpochMs = getExpiryEpochInMs(pemCert, cnName);
            } else if (mode === "file") {
                expiryDateEpochMs = getExpiryEpochInMs(fs.readFileSync(pemCert).toString(), cnName);
            }

            const pfxPassword = crypto.randomBytes(64).toString("hex");
            const cmd: string = `openssl pkcs12 -export -out "${pfxPath}" -passout "pass:${pfxPassword}" -inkey "${pemKeyPath}" -in "${pemCertPath}"`;
            cp.exec(cmd, (cmdError) => {
                if (cmdError) {
                    throw new Error(`failed to generate PFX. (${cmdError.code}) - ${cmdError.message}`);
                }

                fs.readFile(pfxPath, (readPfxError, pfxBuffer) => {
                    if (readPfxError) {
                        throw new Error(`failed to read PFX. (${readPfxError.code}) - ${readPfxError.message}`);
                    }
                    // cleanup
                    if (mode === "data") {
                        fs.unlinkSync(pemKeyPath);
                        fs.unlinkSync(pemCertPath);
                    }
                    fs.unlinkSync(pfxPath);
                    fs.rmdirSync(folder);

                    resolve({
                        cert: pfxBuffer.toString("base64"),
                        expiryDateEpochMs,
                        privateKey: pfxPassword,
                    });
                });
            });
        });
    });
};

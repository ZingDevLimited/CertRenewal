import { GenerateCertAsync } from "./letsEncrypt";

// TODO: login to az CLI as user who has permissions
// fill in values in method below and run it to generate certificate
// subdomain can be: a valid subdomain, * for wildcard or blank for root
// use letsEncryptMode staging to test everything works and letsEncryptMode production to generate a real cert.
(async () => {
    console.log("generating cert please wait ...");
    const cert = await GenerateCertAsync({
        certType: "pfx",
        dnsResourceGroupName: "",
        dnsSubscriptionId: "",
        domain: "",
        letsEncryptMode: "staging",
        notifyEmail: "",
        subDomain: "",
    });
    console.log(`expiry MS Epoch: ${cert.expiryDateEpochMs}`);
    console.log(`passkey: ${cert.privateKey}`);
    console.log(`cert:\n${cert.cert}\n`);
})();

import { GenerateCertAsync } from "./letsEncrypt";

// TODO: login to az CLI and select correct subscription
// fill in values in method below and run it to generate certificate
(async () => {
    console.log("generating cert please wait ...");
    const cert = await GenerateCertAsync({
        certType: "pfx",
        dnsResourceGroupName: "",
        dnsSubscriptionId: "",
        domain: "simplifi.app",
        letsEncryptMode: "staging",
        notifyEmail: "dan.hyrjak@zing.dev",
        subDomain: "",
    });
    console.log(`expiry MS Epoch: ${cert.expiryDateEpochMs}`);
    console.log(`passkey: ${cert.privateKey}`);
    console.log(`cert:\n${cert.cert}\n`);
})();

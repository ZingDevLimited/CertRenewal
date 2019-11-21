# Cert Renewal

## Overview

Quick application to generate a Lets Encrypt certificate for specific sub domain or wildcard for a given domain whereby the domains DNS is managed by an Azure DNS provider and you are logged into the subscription via the Azure CLI.

## Requirements

Node Installed.
Azure CLI Installed.

## Usage

Login to the Azure CaLI and select the subscription that the Azure DNS provider lives in for the domain you wish to create a certificate for.

Note: the user account you login as must have permissions to create and delete record sets in the Azure DNS provider.

Update the values in index.ts for the certificate you wish to generate. Note: the application supports both staging mode, for testing, and production mode for generating a real certificate. 

**Note:** it is recomended to use staging mode first to make sure your command is correct so you don't hit Lets Encrpyt's usage limits.

Run ``npm run start`` to launch the script. Certificate details will be written to the console.
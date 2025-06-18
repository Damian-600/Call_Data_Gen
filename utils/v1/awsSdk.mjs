import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export const getSecret = async (secretId, region) => {
  // Initialise Command(s)
  const params = {
    SecretId: secretId,
  };
  const smGetSecret = new GetSecretValueCommand(params);

  try {
    // Initialise client
    const smClient = new SecretsManagerClient({
      region: region || process.env.AWS_SM_CONF_REGION,
    });

    const data = await smClient.send(smGetSecret);

    return {
      statusCode: data.$metadata.httpStatusCode,
      data: data.SecretString,
    };
  } catch (err) {
    return err;
  }
};

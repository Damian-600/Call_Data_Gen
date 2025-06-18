This is base Nodejs template with the express API route. This template uses basic authentication. Majority of app's configuration is added to process.env at start by fetching data from AWS secret manager.

# Mandatory local environmental varibles (.env)

NODE_ENV - operational mode, supported values "development" and "production"
PORT - Port on which the app runs. Default 8003
AWS_SM_CONF_REGION = region where the AWS SM records that holds app's configuration data is located
AWS_SM_APP_SECRET - Name of AWS SM records that holds app's configuration data
CW_LOG_LEVEL = specifies if all requests should be logged or only errors, supported values "audit" and "error"

# Mandatory remote environmental varibles (AWS SM)

{"username":"app username","password":"app password","awsCloudWatchRegion":"region where CW Log Group is located","awsCloudWatchLogGroup":"name of the log group"}

# Provisioning

This app depends on AWS Secret Manager and Cloud Watch. You must create both resources and grant the necessary permission.

Example IAM role:
{
"Version": "2012-10-17",
"Statement": [
{
"Sid": "AccessToSecreteManager",
"Effect": "Allow",
"Action": [
"secretsmanager:GetSecretValue",
"secretsmanager:DescribeSecret",
"secretsmanager:ListSecretVersionIds",
"secretsmanager:UpdateSecret"
],
"Resource": [

                "arn:aws:secretsmanager:eu-west-1:123456789:secret:dev-baseAppConfig-1234"
            ]
        },
        {
            "Sid": "PutCWlogs",
            "Effect": "Allow",
            "Action": [
                "logs:PutLogEvents",
                "logs:CreateLogStream"
            ],
            "Resource": [
                "arn:aws:logs:eu-west-1:123456789:log-group:nodejs_base_template:*"
            ]
        }
    ]

}

#Call Data Generation tool

# KPI endpoin payload

dateFrom and dateTo should be supplied in milliseconds

{
"dateFrom": 1774828800000,
"dateTo": 1774915140000,
"customerUuid": "4759c614-aab0-4b97-8833-f2da911f6c20"
}

# CDR data

# SM must contain

{
"username":"****\*\*****",
"password":"**\*\*\*\***",
"awsCloudWatchRegion":"eu-west-2",
"awsCloudWatchLogGroup":"/cucx/tools/clientPortal-data-gen-app",
"dataPrepperAuth":"basic auth string in Base64, passed to Auth header",
"dbEndpoint":"endpoint RDS FQDN",
"dbInstanceName":"DB name",
"dbUserName":"****\*****",
"dbPassword":"****\*****",
"DATA_PREPPER_FQDN":"FQDN of the data pipeline server",
"CW_LOG_LEVEL ":"error"
}

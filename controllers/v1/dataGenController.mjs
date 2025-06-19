import util from "node:util";
import { randomBytes as randomBytesCb, randomUUID } from "node:crypto";

import catchAsync from "../../utils/v1/catchAsync.mjs";
import AppError from "../../utils/v1/appError.mjs";

import { object, string, array, number } from "yup";

import { postKpisToPipeline } from "../../utils/v1/dataPrepper.mjs";

export const generateKpiData = catchAsync(async (req, res, next) => {
  // Random number generation functions
  const randomInteger = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  const randomDecimalInteger = (min, max, decimalPlaces) => {
    return (Math.random() * (max - min) + min).toFixed(decimalPlaces) * 1;
  };

  const customerAssets = req.body;

  /*
    Input validatation, schema must be correct to ensure data consisitency in OpenSearch mapping
  */

  // validate schema of the supplied body
  const assetSchema = array(
    object({
      sbcName: string().required(),
      assetType: string()
        .required()
        .matches(/^Multitenant$|^Dedicated$/),
      serviceType: string().when("assetType", {
        is: "Multitenant",
        then: (assetSchema) => assetSchema.required(),
        otherwise: (assetSchema) => assetSchema.optional(),
      }),
      ipGroupNames: array().required(),
      quality: string().required(),
    })
  ).min(1, "Expected at lease 1 asset to be supplied in the request");

  try {
    await assetSchema.validate(customerAssets);
  } catch (err) {
    return next(
      new AppError(
        `ERROR: Supplied body has incorrect format: ERR - ${err.errors}`,
        500,
        `ERROR: Supplied body has incorrect format: ERR - ${err.errors}`
      )
    );
  }

  // Date ranges from 00:00 to 23:59 of current date
  const range = {
    todayStart: new Date(new Date().setUTCHours(9, 0, 0, 0)).getTime(),
    todayEnd: new Date(new Date().setUTCHours(17, 0, 0, 0)).getTime(),
  };

  /*
    Setting intervals every 15 minutes and generating timestamps for each interval in milliscends
    We wil use these timestamps as value when submitting data to OpenSearch
  */

  let currentInterval = range.todayStart;
  const timeIncrementsMs = 900000;
  const intervals = [];

  while (currentInterval <= range.todayEnd) {
    intervals.push(currentInterval);

    currentInterval += timeIncrementsMs;
  }

  // Looping over 15 sec intervals and submititng data
  for (const _interval of intervals) {
    console.log(`Processing interval ${new Date(_interval)}`);

    // Process all assets
    await Promise.all(
      customerAssets.map(async (_asset) => {
        try {
          const body = {
            sbcName: _asset.sbcName,
            cycleTimestamp: _interval,
            kpiType: "historical",
            assetType: _asset.assetType,
            ...(_asset.assetType === "Multitenant" && { serviceType: _asset.serviceType }),
            sbcKpis: _asset.ipGroupNames.map((_ipg) => {
              return {
                ipGroupName: _ipg,
                mediaJitterInAvg:
                  _asset.quality === "poor"
                    ? randomDecimalInteger(50, 100, 1)
                    : _asset.quality === "medium"
                    ? randomDecimalInteger(30, 50, 1)
                    : randomDecimalInteger(0, 3, 1),
                mediaJitterOutAvg:
                  _asset.quality === "poor"
                    ? randomDecimalInteger(50, 100, 1)
                    : _asset.quality === "medium"
                    ? randomDecimalInteger(30, 50, 1)
                    : randomDecimalInteger(0, 3, 1),

                mediaMOSInAvg:
                  _asset.quality === "poor"
                    ? randomInteger(10, 29)
                    : _asset.quality === "medium"
                    ? randomInteger(30, 39)
                    : randomDecimalInteger(40, 42),

                mediaMOSOutAvg:
                  _asset.quality === "poor"
                    ? randomInteger(10, 29)
                    : _asset.quality === "medium"
                    ? randomInteger(30, 39)
                    : randomDecimalInteger(40, 42),

                mediaPacketLossInAvg:
                  _asset.quality === "poor"
                    ? randomDecimalInteger(6.6, 10, 1)
                    : _asset.quality === "medium"
                    ? randomDecimalInteger(2.7, 6.6, 1)
                    : randomDecimalInteger(0, 2.7, 1),

                mediaPacketLossOutAvg:
                  _asset.quality === "poor"
                    ? randomDecimalInteger(6.6, 10, 1)
                    : _asset.quality === "medium"
                    ? randomDecimalInteger(2.7, 6.6, 1)
                    : randomDecimalInteger(0, 2.7, 1),

                minutesOfUsage: randomInteger(25, 45),

                averageCallDurationAvg: randomInteger(40, 360),
              };
            }),
          };

          const postToPipelineOutcome = await postKpisToPipeline(
            process.env.dataPrepperAuth,
            body,
            "kip"
          );

          if (postToPipelineOutcome.statusCode !== 200) {
            console.log(
              `ERROR: Processing asset ${_asset.serviceType}. ERR - ${postToPipelineOutcome.body}`
            );
          }
        } catch (error) {
          console.log(error);
        }
      })
    );
  }

  res.status(200).send({ status: "success", data: "KPI data submitted." });
});

export const generateCdrData = catchAsync(async (req, res, next) => {
  const cdrData = req.body;

  /*
    Input validatation, schema must be correct to ensure data consisitency in OpenSearch mapping
  */

  // validate schema of the supplied body
  const assetSchema = object({
    noCallsPerInterval: number().required().min(1, "Value must be greater than 0"),
    sbcNames: array().required().min(1, "At least 1 SBC name must be provided"),
    services: array(
      object({
        ipGroup: string().required(),
        numberRangeFrom: number().required(),
        numberRangeTo: number().required(),
      })
    )
      .min(1)
      .required()
      .min(1),
    pstn: object({
      ipGroup: string().required(),
      numberRangeFrom: number().required(),
      numberRangeTo: number().required(),
    }).required(),
  });

  try {
    await assetSchema.validate(cdrData);
  } catch (err) {
    return next(
      new AppError(
        `ERROR: Supplied body has incorrect format: ERR - ${err.errors}`,
        500,
        `ERROR: Supplied body has incorrect format: ERR - ${err.errors}`
      )
    );
  }

  // Random number generation functions
  const randomInteger = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  const randomDecimalInteger = (min, max, decimalPlaces) => {
    return (Math.random() * (max - min) + min).toFixed(decimalPlaces) * 1;
  };

  const callDirections = ["ingress", "egress"];

  const generateRandomId = async (length) => {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";

    try {
      if (!length || length > 25) throw Error("Unsupported length value");

      // Promisify randomByte method to avoid call backs
      const randomByte = util.promisify(randomBytesCb);
      const bytes = await randomByte(length);

      for (let i = 0; i < length; i++) {
        result += chars[bytes[i] % chars.length];
      }

      return result;
    } catch (err) {
      return undefined;
    }
  };

  const generateCdr = async (data) => {
    const currentTimeInteval = Date.now();
    const callDirection = callDirections[randomInteger(0, callDirections.length - 1)];
    const callDuration = randomInteger(3000, 36000);
    const callConnectObj = new Date(currentTimeInteval);
    const callReleaseObj = new Date(currentTimeInteval + callDuration * 10);

    const directionBaseData = {};

    switch (callDirection) {
      case "ingress": {
        const dstServiceIndex = randomInteger(0, data.services.length - 1);

        directionBaseData.ingressIpGroupName = data.pstn.ipGroup;
        directionBaseData.ingressSipInterfaceName = "UDP_SipInterface";
        directionBaseData.egressSipInterfaceName = "TLS_SipInterface";
        directionBaseData.egressIpGroupName = data.services[dstServiceIndex].ipGroup;
        directionBaseData.callingUserBeforeManipulation = `+${randomInteger(
          data.pstn.numberRangeFrom,
          data.pstn.numberRangeTo
        )}`;
        directionBaseData.callingUserAfterManipulation =
          directionBaseData.callingUserBeforeManipulation;
        directionBaseData.calledUserBeforeManipulation = `+${randomInteger(
          data.services[dstServiceIndex].numberRangeFrom,
          data.services[dstServiceIndex].numberRangeTo
        )}`;
        directionBaseData.calledUserAfterManipulation =
          directionBaseData.calledUserBeforeManipulation;
        directionBaseData.ingressLocalRtpIp = "10.0.11.175";
        directionBaseData.ingressRemoteRtpIp = "88.215.55.12";
        directionBaseData.egressLocalRtpIp = "10.0.11.175";
        directionBaseData.egressRemoteRtpIp = "52.112.239.12";
        directionBaseData.ingressCallSourceIp = "88.215.55.11";
        directionBaseData.egressCallDestIp = "52.114.76.76";
        directionBaseData.setupTime = `${callConnectObj.getUTCHours()}:${callConnectObj.getUTCMinutes()}:${callConnectObj.getUTCSeconds()}.${callConnectObj.getUTCMilliseconds()}  UTC ${callConnectObj.toLocaleDateString(
          "en-GB",
          {
            weekday: "short",
          }
        )} ${callConnectObj.toLocaleDateString("en-GB", {
          month: "short",
        })} ${callConnectObj.toLocaleDateString("en-GB", {
          day: "numeric",
        })} ${callConnectObj.toLocaleDateString("en-GB", {
          year: "numeric",
        })}`;
        directionBaseData.connectTimeUTC = `${callConnectObj.getUTCHours()}:${callConnectObj.getUTCMinutes()}:${callConnectObj.getUTCSeconds()}.${callConnectObj.getUTCMilliseconds()}  UTC ${callConnectObj.toLocaleDateString(
          "en-GB",
          {
            weekday: "short",
          }
        )} ${callConnectObj.toLocaleDateString("en-GB", {
          month: "short",
        })} ${callConnectObj.toLocaleDateString("en-GB", {
          day: "numeric",
        })} ${callConnectObj.toLocaleDateString("en-GB", {
          year: "numeric",
        })}`;
        directionBaseData.releaseTimeUTC = `${callReleaseObj.getUTCHours()}:${callReleaseObj.getUTCMinutes()}:${callReleaseObj.getUTCSeconds()}.${callReleaseObj.getUTCMilliseconds()}  UTC ${callReleaseObj.toLocaleDateString(
          "en-GB",
          {
            weekday: "short",
          }
        )} ${callReleaseObj.toLocaleDateString("en-GB", {
          month: "short",
        })} ${callReleaseObj.toLocaleDateString("en-GB", {
          day: "numeric",
        })} ${callReleaseObj.toLocaleDateString("en-GB", {
          year: "numeric",
        })}`;
        break;
      }
      case "egress": {
        const srcServiceIndex = randomInteger(0, data.services.length - 1);

        directionBaseData.ingressIpGroupName = data.services[srcServiceIndex].ipGroup;
        directionBaseData.egressIpGroupName = data.pstn.ipGroup;
        directionBaseData.ingressSipInterfaceName = "TLS_SipInterface";
        directionBaseData.egressSipInterfaceName = "UDP_SipInterface";

        directionBaseData.callingUserBeforeManipulation = `+${randomInteger(
          data.services[srcServiceIndex].numberRangeFrom,
          data.services[srcServiceIndex].numberRangeTo
        )}`;
        directionBaseData.callingUserAfterManipulation =
          directionBaseData.callingUserBeforeManipulation;
        directionBaseData.calledUserBeforeManipulation = `+${randomInteger(
          data.pstn.numberRangeFrom,
          data.pstn.numberRangeTo
        )}`;
        directionBaseData.calledUserAfterManipulation =
          directionBaseData.calledUserBeforeManipulation;
        directionBaseData.ingressLocalRtpIp = "10.0.11.175";
        directionBaseData.ingressRemoteRtpIp = "52.112.239.12";
        directionBaseData.egressLocalRtpIp = "10.0.11.175";
        directionBaseData.egressRemoteRtpIp = "88.215.55.12";
        directionBaseData.ingressCallSourceIp = "52.114.76.76";
        directionBaseData.egressCallDestIp = "88.215.55.11";
        directionBaseData.setupTime = `${callConnectObj.getUTCHours()}:${callConnectObj.getUTCMinutes()}:${callConnectObj.getUTCSeconds()}.${callConnectObj.getUTCMilliseconds()}  UTC ${callConnectObj.toLocaleDateString(
          "en-GB",
          {
            weekday: "short",
          }
        )} ${callConnectObj.toLocaleDateString("en-GB", {
          month: "short",
        })} ${callConnectObj.toLocaleDateString("en-GB", {
          day: "numeric",
        })} ${callConnectObj.toLocaleDateString("en-GB", {
          year: "numeric",
        })}`;
        directionBaseData.connectTimeUTC = `${callConnectObj.getUTCHours()}:${callConnectObj.getUTCMinutes()}:${callConnectObj.getUTCSeconds()}.${callConnectObj.getUTCMilliseconds()}  UTC ${callConnectObj.toLocaleDateString(
          "en-GB",
          {
            weekday: "short",
          }
        )} ${callConnectObj.toLocaleDateString("en-GB", {
          month: "short",
        })} ${callConnectObj.toLocaleDateString("en-GB", {
          day: "numeric",
        })} ${callConnectObj.toLocaleDateString("en-GB", {
          year: "numeric",
        })}`;
        directionBaseData.releaseTimeUTC = `${callReleaseObj.getUTCHours()}:${callReleaseObj.getUTCMinutes()}:${callReleaseObj.getUTCSeconds()}.${callReleaseObj.getUTCMilliseconds()}  UTC ${callReleaseObj.toLocaleDateString(
          "en-GB",
          {
            weekday: "short",
          }
        )} ${callReleaseObj.toLocaleDateString("en-GB", {
          month: "short",
        })} ${callReleaseObj.toLocaleDateString("en-GB", {
          day: "numeric",
        })} ${callReleaseObj.toLocaleDateString("en-GB", {
          year: "numeric",
        })}`;

        break;
      }
      default:
        break;
    }

    // Desctruct direction based data to be used as CDR values
    const {
      ingressIpGroupName,
      egressIpGroupName,
      ingressSipInterfaceName,
      egressSipInterfaceName,
      callingUserBeforeManipulation,
      callingUserAfterManipulation,
      calledUserBeforeManipulation,
      calledUserAfterManipulation,
      ingressLocalRtpIp,
      ingressRemoteRtpIp,
      egressLocalRtpIp,
      egressRemoteRtpIp,
      ingressCallSourceIp,
      egressCallDestIp,
      connectTimeUTC,
      releaseTimeUTC,
      setupTime,
    } = directionBaseData;

    return {
      recordType: "STOP",
      productName: data.sbcNames[randomInteger(0, data.sbcNames.length - 1)],
      setupTime,
      globalSessionId: await generateRandomId(16),
      sessionId: await generateRandomId(12),
      isSuccess: "yes",
      connectTimeUTC,
      releaseTimeUTC,
      timeToConnect: randomInteger(100, 300),
      callDuration: callDuration,
      timeZone: "UTC",
      callingUserBeforeManipulation,
      callingUserAfterManipulation,
      calledUserBeforeManipulation,
      calledUserAfterManipulation,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp,
      egressCallDestIp,
      ingressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressCallId: randomUUID(),
      egressCallId: randomUUID(),
      egressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressSipTrmReason: "BYE",
      ingressSipTrmDescr: "",
      egressSipTrmReason: "BYE",
      egressSipTrmDescr: "",
      ingressSipInterfaceName,
      ingressIpGroupName,
      egressSipInterfaceName,
      egressIpGroupName,
      ingressLocalRtpIp,
      ingressLocalRtpPort: randomInteger(6000, 65535),
      ingressRemoteRtpIp,
      ingressRemoteRtpPort: randomInteger(25000, 65535),
      egressLocalRtpIp,
      egressLocalRtpPort: randomInteger(6000, 65535),
      egressRemoteRtpIp,
      egressRemoteRtpPort: randomInteger(25000, 65535),
      ingressCodec: "g711Alaw64k",
      egressCodec: "g711Alaw64k",
      ingressPacketLoss: randomDecimalInteger(0, 1.5, 1),
      egressPacketLoss: randomDecimalInteger(0, 1.5, 1),
      ingressLocalPacketLoss: randomDecimalInteger(0, 1.5, 1),
      egressLocalPacketLoss: randomDecimalInteger(0, 1.5, 1),
      ingressLocalJitter: randomDecimalInteger(0, 15, 1),
      ingressRemoteJitter: randomDecimalInteger(0, 15, 1),
      egressLocalJitter: randomDecimalInteger(0, 15, 1),
      egressRemoteJitter: randomDecimalInteger(0, 15, 1),
      ingressLocalMos: randomDecimalInteger(40, 42),
      ingressRemoteMos: randomDecimalInteger(40, 42),
      egressLocalMos: randomDecimalInteger(40, 42),
      egressRemoteMos: randomDecimalInteger(40, 42),
      ingressLocalRoudTripDelay: 0,
      ingressRemoteRoudTripDelay: 0,
      egressLocalRoudTripDelay: 0,
      egressRemoteRoudTripDelay: 0,
      ingressUser: "",
      ingressService: "",
      egressUser: "",
      egressService: "",
      egressLocalInputPackets: 369,
      egressLocalOutputPackets: 355,
      ingressLocalInputPackets: 355,
      ingressLocalOutputPackets: 369,
    };
  };

  // Date ranges from 00:00 to 23:59 of current date
  const range = {
    todayStart: new Date(new Date().setUTCHours(9, 0, 0, 0)).getTime(),
    todayEnd: new Date(new Date().setUTCHours(17, 0, 0, 0)).getTime(),
  };

  /*
    Setting intervals every 15 minutes and generating timestamps for each interval in milliscends
    We wil use these timestamps as value when submitting data to OpenSearch
  */

  let currentInterval = range.todayStart;
  const timeIncrementsMs = 900000;
  const intervals = [];

  while (currentInterval <= range.todayEnd) {
    intervals.push(currentInterval);

    currentInterval += timeIncrementsMs;
  }

  // Looping over 15 sec intervals and submititng data
  for (const _interval of intervals) {
    console.log(`Processing interval ${new Date(_interval)}`);

    let i = 0;
    while (i < cdrData.noCallsPerInterval) {
      i += 1;

      try {
        const body = await generateCdr(cdrData);

        const postToPipelineOutcome = await postKpisToPipeline(
          process.env.dataPrepperAuth,
          body,
          "sbcCdr"
        );

        if (postToPipelineOutcome.statusCode !== 200) {
          console.log(
            `ERROR: Failed to poast cdr records to pipeline- ERR: ${JSON.stringify(
              postToPipelineOutcome.body
            )}`
          );
        }
      } catch (error) {
        console.log(error);
      }
    }
  }

  res.status(200).send(`CDR data generated and submitted to pipeline`);
});

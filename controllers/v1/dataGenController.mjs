import util from "node:util";
import { randomBytes as randomBytesCb, randomUUID } from "node:crypto";

import catchAsync from "../../utils/v1/catchAsync.mjs";
import AppError from "../../utils/v1/appError.mjs";

import { object, string, array } from "yup";

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

  // Looping over 15 sec intervals and submititng data in bulk for each asset type
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

          const postToPipelineOutcome = await postKpisToPipeline(process.env.dataPrepperAuth, body);

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

  // Random number generation functions
  const randomInteger = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
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
    console.log(callDirection);

    const directionBaseData = {};

    switch (callDirection) {
      case "ingress":
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

      default:
        break;
    }

    // const directionBaseDate =
    //   callDirection === "ingress"
    //     ? {
    //         ingressIpGroupName: data.pstn.ipGroup,
    //         ingressSipInterfaceName: "UDP_SipInterface",
    //         egressSipInterfaceName: "TLS_SipInterface",
    //         egressIpGroupName: data.services[randomInteger(0, data.services.length - 1)].ipGroup,
    //         callingUserBeforeManipulation: `+${randomInteger(
    //           data.pstn.numberRangeFrom,
    //           data.pstn.numberRangeTo
    //         )}`,
    //         callingUserAfterManipulation: `+${randomInteger(
    //           data.pstn.numberRangeFrom,
    //           data.pstn.numberRangeTo
    //         )}`,
    //         calledUserBeforeManipulation:
    //           data.services[
    //             data.services.findIndex((_el) => _el.ipGroup === this.egressIpGroupName)
    //           ].numberRangeFrom,
    //       }
    //     : {
    //         ingressIpGroupName: data.services[randomInteger(0, data.services.length - 1)].ipGroup,
    //         ingressSipInterfaceName: "TLS_SipInterface",
    //         egressSipInterfaceName: "UDP_SipInterface",
    //         egressIpGroupName: data.pstn.ipGroup,
    //       };

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
    } = directionBaseData;

    return {
      recordType: "STOP",
      productName: data.sbcNames[randomInteger(0, data.sbcNames.length - 1)],
      setupTime: "14:19:13.745  UTC Wed Jun 18 2025",
      globalSessionId: await generateRandomId(16),
      sessionId: await generateRandomId(12),
      isSuccess: "yes",
      connectTimeUTC: new Date(currentTimeInteval),
      releaseTimeUTC: new Date(currentTimeInteval + callDuration * 10),
      timeToConnect: randomInteger(100, 300),
      callDuration: callDuration,
      timeZone: "UTC",
      callingUserBeforeManipulation,
      callingUserAfterManipulation,
      calledUserBeforeManipulation,
      calledUserAfterManipulation,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: "88.215.55.11",
      egressCallDestIp: "52.114.76.76",
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
      ingressLocalRtpIp: "10.0.11.175",
      ingressLocalRtpPort: 6000,
      ingressRemoteRtpIp: "88.215.55.12",
      ingressRemoteRtpPort: 25312,
      egressLocalRtpIp: "10.0.11.175",
      egressLocalRtpPort: 6004,
      egressRemoteRtpIp: "52.112.239.12",
      egressRemoteRtpPort: 50286,
      ingressCodec: "g711Alaw64k",
      egressCodec: "g711Alaw64k",
      ingressPacketLoss: 0,
      egressPacketLoss: 0,
      ingressLocalPacketLoss: 0, //
      egressLocalPacketLoss: 0, //
      ingressLocalJitter: 4, //
      ingressRemoteJitter: 4294967295, //
      egressLocalJitter: 7, //
      egressRemoteJitter: 15, //
      ingressLocalMos: 127, //
      ingressRemoteMos: 127, //
      egressLocalMos: 127, //
      egressRemoteMos: 127, //
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

  const cdrReord = await generateCdr(cdrData);
  res.status(200).send(cdrReord);
});

import {
  getMTassets,
  getDedicatedAssets,
  getMTassetsAndDdis,
  getMTinfraModules,
} from "../../utils/v1/dbAPI.mjs";
import { pickRandomUkMobile } from "../../utils/v1/pstnNumbers.mjs";

import util from "node:util";
import { randomBytes as randomBytesCb, randomUUID } from "node:crypto";

import catchAsync from "../../utils/v1/catchAsync.mjs";
import AppError from "../../utils/v1/appError.mjs";

import { object, string, array, number } from "yup";

import { postKpisToPipeline } from "../../utils/v1/dataPrepper.mjs";

// Utility function to split and reformat Multitenant assets
const splitAndFormatMtAssets = (mtAssets) => {
  const result = [];
  mtAssets.forEach((asset) => {
    // Find all sbcName keys (e.g., sbcName1, sbcName2, ...)
    Object.keys(asset)
      .filter((key) => key.startsWith("sbcName"))
      .forEach((sbcKey) => {
        if (asset[sbcKey]) {
          // Remove everything after the first '.' in the sbcName value
          const sbcNameShort = asset[sbcKey].split(".")[0];

          const ipGroupNamesParsed = asset.ipGroupNames.map((ipg) => {
            if (asset.serviceType === "Teams") return `Teams_${ipg}`;
            return ipg;
          });
          result.push({
            assetType: asset.assetType,
            sbcName: sbcNameShort,
            serviceType: asset.serviceType,
            ipGroupNames: ipGroupNamesParsed,
          });
        }
      });
  });
  return result;
};

export const generateCdrDataAuto = catchAsync(async (req, res, next) => {
  let { successRecordsPerInterval, failedRecordsPerInterval, dateFrom, dateTo, customerUuid } =
    req.body;

  if (
    successRecordsPerInterval === undefined ||
    failedRecordsPerInterval === undefined ||
    dateFrom === undefined ||
    dateTo === undefined ||
    !customerUuid
  ) {
    return next(
      new AppError(
        "Missing required fields: successRecordsPerInterval, failedRecordsPerInterval, dateFrom, dateTo, customerUuid",
        400,
      ),
    );
  }

  successRecordsPerInterval = Number(successRecordsPerInterval);
  failedRecordsPerInterval = Number(failedRecordsPerInterval);
  dateFrom = Number(dateFrom);
  dateTo = Number(dateTo);

  if ([successRecordsPerInterval, failedRecordsPerInterval, dateFrom, dateTo].some(Number.isNaN)) {
    return next(new AppError("Numeric fields must be valid numbers", 400));
  }

  if (dateFrom < 1000000000000) dateFrom *= 1000;
  if (dateTo < 1000000000000) dateTo *= 1000;

  if (dateTo <= dateFrom) return next(new AppError("dateTo must be after dateFrom", 400));

  const mtAssets = await getMTassetsAndDdis(customerUuid);
  if (mtAssets instanceof Error)
    return next(new AppError(`Error fetching MT assets: ${mtAssets.message}`, 500));
  if (!mtAssets || mtAssets.length === 0)
    return next(new AppError("No assets found for customer", 404));

  const mtInfraModules = await getMTinfraModules(customerUuid);
  if (mtInfraModules instanceof Error)
    return next(new AppError(`Error fetching infra modules: ${mtInfraModules.message}`, 500));

  const proxyModule = mtInfraModules.find((m) => m.moduleType === "Proxy");
  const pstnModule = mtInfraModules.find((m) => m.moduleType === "Pstn");

  if (!proxyModule) return next(new AppError("Proxy infra module not found", 404));
  if (!pstnModule) return next(new AppError("PSTN infra module not found", 404));

  // ── Utilities ──────────────────────────────────────────────────────────────
  const shortName = (fqdn) => (fqdn ? fqdn.split(".")[0] : fqdn);
  const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const ipInc = (ip, n = 1) => {
    const parts = ip.split(".");
    parts[3] = String(Number(parts[3]) + n);
    return parts.join(".");
  };

  const formatTime = (ms) => {
    const d = new Date(ms);
    return (
      `${d.getUTCHours()}:${d.getUTCMinutes()}:${d.getUTCSeconds()}.${d.getUTCMilliseconds()}` +
      `  UTC ${d.toLocaleDateString("en-GB", { weekday: "short" })}` +
      ` ${d.toLocaleDateString("en-GB", { month: "short" })}` +
      ` ${d.toLocaleDateString("en-GB", { day: "numeric" })}` +
      ` ${d.toLocaleDateString("en-GB", { year: "numeric" })}`
    );
  };

  const genId = async (len) => {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    const randomByte = util.promisify(randomBytesCb);
    const bytes = await randomByte(len);
    return Array.from({ length: len }, (_, i) => chars[bytes[i] % chars.length]).join("");
  };

  const genSessionId = () => {
    const hex = Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, "0");
    return `${hex}:${randomInt(10, 999)}:${randomInt(100, 99999)}`;
  };

  const genCallId = (ip) => `${randomInt(100000000, 999999999)}${Date.now()}@${ip}`;

  // ── Helpers derived from asset metadata ────────────────────────────────────
  // DEV-CE-IRL-WEBEX01 → EMEA_CE_WEBEX_01
  const deriveProxyIpGroup = (sbcName1) => {
    const parts = shortName(sbcName1).split("-");
    const tier = parts[1];
    const lastPart = parts[3];
    const name = lastPart.replace(/\d+$/, "");
    const num = lastPart.match(/\d+$/)?.[0] ?? "01";
    return `EMEA_${tier}_${name}_${num}`;
  };

  const getSipInterfaceName = (serviceType) => {
    if (serviceType === "Webex_CCP") return "Webex";
    if (serviceType === "Teams" || serviceType === "Teams_OC") return "Teams";
    return "SIP";
  };

  const isTeams = (serviceType) => serviceType === "Teams" || serviceType === "Teams_OC";

  // External RTP IP for SBCs bridging internal/external networks
  // Pattern observed: routing subnet .8.x → .7.(x+4)
  const externalRtpIp = (routingIp) => {
    const parts = routingIp.split(".");
    return `${parts[0]}.${parts[1]}.${Number(parts[2]) - 1}.${Number(parts[3]) + 4}`;
  };

  // ── Infrastructure values from DB ──────────────────────────────────────────
  const proxySbcName = shortName(proxyModule.sbcName1);
  const pstnSbcName = shortName(pstnModule.sbcName1);

  const kamailioIp = (() => {
    const parts = proxyModule.sbc1RoutingIp.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.254`;
  })();

  const gammaSigIp = pstnModule.sbc1Ip;
  const gammaMediaIp = ipInc(pstnModule.sbc1Ip);
  const pstnProxyIpGroup = deriveProxyIpGroup(pstnModule.sbcName1);

  // ── Empty RTP block (PROXY records and ATTEMPT redirect records) ────────────
  const EMPTY_RTP = {
    ingressLocalRtpIp: "",
    ingressLocalRtpPort: "",
    ingressRemoteRtpIp: "",
    ingressRemoteRtpPort: "",
    egressLocalRtpIp: "",
    egressLocalRtpPort: "",
    egressRemoteRtpIp: "",
    egressRemoteRtpPort: "",
    ingressCodec: "",
    egressCodec: "",
    ingressPacketLoss: "",
    egressPacketLoss: "",
    ingressLocalPacketLoss: "",
    egressLocalPacketLoss: "",
    ingressLocalJitter: "",
    ingressRemoteJitter: "",
    egressLocalJitter: "",
    egressRemoteJitter: "",
    ingressLocalMos: "",
    ingressRemoteMos: "",
    egressLocalMos: "",
    egressRemoteMos: "",
    ingressLocalRoudTripDelay: "",
    ingressRemoteRoudTripDelay: "",
    egressLocalRoudTripDelay: "",
    egressRemoteRoudTripDelay: "",
    egressLocalInputPackets: "",
    egressLocalOutputPackets: "",
    ingressLocalInputPackets: "",
    ingressLocalOutputPackets: "",
  };

  const rtpBlock = (ingressLocalIp, ingressRemoteIp, egressLocalIp, egressRemoteIp) => ({
    ingressLocalRtpIp: ingressLocalIp,
    ingressLocalRtpPort: randomInt(6000, 29999),
    ingressRemoteRtpIp: ingressRemoteIp,
    ingressRemoteRtpPort: randomInt(6000, 29999),
    egressLocalRtpIp: egressLocalIp,
    egressLocalRtpPort: randomInt(6000, 29999),
    egressRemoteRtpIp: egressRemoteIp,
    egressRemoteRtpPort: randomInt(10000, 65535),
    ingressCodec: "g711Alaw64k",
    egressCodec: "g711Alaw64k",
    ingressPacketLoss: 0,
    egressPacketLoss: 0,
    ingressLocalPacketLoss: 0,
    egressLocalPacketLoss: 0,
    ingressLocalJitter: randomInt(0, 127),
    ingressRemoteJitter: randomInt(0, 127),
    egressLocalJitter: randomInt(0, 127),
    egressRemoteJitter: randomInt(0, 127),
    ingressLocalMos: 127,
    ingressRemoteMos: 127,
    egressLocalMos: 127,
    egressRemoteMos: 127,
    ingressLocalRoudTripDelay: randomInt(0, 5),
    ingressRemoteRoudTripDelay: randomInt(0, 5),
    egressLocalRoudTripDelay: randomInt(0, 5),
    egressRemoteRoudTripDelay: randomInt(0, 5),
    egressLocalInputPackets: randomInt(200, 1500),
    egressLocalOutputPackets: randomInt(200, 1500),
    ingressLocalInputPackets: randomInt(200, 1500),
    ingressLocalOutputPackets: randomInt(200, 1500),
  });

  // ── SCENARIO 1 — Service → PSTN ───────────────────────────────────────────
  // Flow: SVC01 → (Kamailio) → SVC01 → PROXY01 → PSTN01  (4 CDR records)
  const genServiceToPstnCdrs = async (serviceAsset, intervalMs) => {
    const callingNumber = `+${serviceAsset.ddis[randomInt(0, serviceAsset.ddis.length - 1)]}`;
    const calledNumber = pickRandomUkMobile();
    const callStartMs = intervalMs + randomInt(0, 899000);
    const callDuration = randomInt(4000, 46000); // centiseconds (×10 ms = 40–460 s)
    const tToConnect = randomInt(100, 500);
    const connectMs = callStartMs + tToConnect;
    const releaseMs = connectMs + callDuration * 10;
    const globalSessionId = await genId(16);
    const svcSbcName = shortName(serviceAsset.sbcName1);
    const svcIngressCallId = randomUUID();
    const svcEgressCallId = genCallId(serviceAsset.sbc1RoutingIp);
    const pstnEgressCallId = genCallId(pstnModule.sbc1Ip);
    const sharedSessionId = genSessionId();
    const svcSigIp = serviceAsset.sbc1Ip;
    const svcSvcRtp = ipInc(serviceAsset.sbc1Ip);
    const svcIntRtp = ipInc(serviceAsset.sbc1RoutingIp);
    const pstnIntRtp = ipInc(pstnModule.sbc1RoutingIp);
    const svcSipIface = getSipInterfaceName(serviceAsset.serviceType);
    const svcProxyGroup = deriveProxyIpGroup(serviceAsset.sbcName1);

    // Record 1: SERVICE ATTEMPT — Kamailio redirect leg (no RTP)
    const svcAttempt = {
      recordType: "ATTEMPT",
      productName: svcSbcName,
      setupTime: formatTime(callStartMs),
      globalSessionId,
      sessionId: sharedSessionId,
      isSuccess: "yes",
      connectTimeUTC: "",
      releaseTimeUTC: formatTime(callStartMs + randomInt(10, 100)),
      timeToConnect: 0,
      callDuration: -1,
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: svcSigIp,
      egressCallDestIp: kamailioIp,
      ingressTrmReason: "",
      ingressCallId: svcIngressCallId,
      egressCallId: svcEgressCallId,
      egressTrmReason: "RELEASE_BECAUSE_FORWARD",
      ingressSipTrmReason: "",
      ingressSipTrmDescr: "",
      egressSipTrmReason: "302",
      egressSipTrmDescr: `SIP ;cause=302 ;text="{302 Moved Temporarily}"`,
      ingressSipInterfaceName: svcSipIface,
      ingressIpGroupName: serviceAsset.ipGroupName,
      egressSipInterfaceName: "Internal",
      egressIpGroupName: "Kamailio_Redirect",
      ...EMPTY_RTP,
      egressUser: "",
      egressService: "",
      ingressUser: callingNumber,
      ingressService: serviceAsset.serviceType,
      egressServiceTenantTag: "",
      ingressServiceTenantTag: serviceAsset.ipGroupName,
    };

    // Record 2: SERVICE STOP — actual call leg (RTP present)
    const svcStop = {
      recordType: "STOP",
      productName: svcSbcName,
      setupTime: formatTime(callStartMs),
      globalSessionId,
      sessionId: sharedSessionId,
      isSuccess: "yes",
      connectTimeUTC: formatTime(connectMs),
      releaseTimeUTC: formatTime(releaseMs),
      timeToConnect: tToConnect,
      callDuration,
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: svcSigIp,
      egressCallDestIp: proxyModule.sbc1RoutingIp,
      ingressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressCallId: svcIngressCallId,
      egressCallId: svcEgressCallId,
      egressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressSipTrmReason: "BYE",
      ingressSipTrmDescr: "",
      egressSipTrmReason: "BYE",
      egressSipTrmDescr: "",
      ingressSipInterfaceName: svcSipIface,
      ingressIpGroupName: serviceAsset.ipGroupName,
      egressSipInterfaceName: "Internal",
      egressIpGroupName: "Proxy",
      ...rtpBlock(svcSvcRtp, svcSigIp, svcIntRtp, pstnIntRtp),
      egressUser: "",
      egressService: "",
      ingressUser: callingNumber,
      ingressService: serviceAsset.serviceType,
      egressServiceTenantTag: "",
      ingressServiceTenantTag: serviceAsset.ipGroupName,
    };

    // Record 3: PROXY STOP — SIP only, no RTP
    const proxyStop = {
      recordType: "STOP",
      productName: proxySbcName,
      setupTime: formatTime(callStartMs + randomInt(5, 30)),
      globalSessionId,
      sessionId: genSessionId(),
      isSuccess: "yes",
      connectTimeUTC: formatTime(connectMs - randomInt(1, 20)),
      releaseTimeUTC: formatTime(releaseMs - randomInt(1, 100)),
      timeToConnect: tToConnect - randomInt(1, 10),
      callDuration: callDuration - randomInt(1, 10),
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: serviceAsset.sbc1RoutingIp,
      egressCallDestIp: pstnModule.sbc1RoutingIp,
      ingressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressCallId: svcEgressCallId,
      egressCallId: svcEgressCallId,
      egressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressSipTrmReason: "BYE",
      ingressSipTrmDescr: "",
      egressSipTrmReason: "BYE",
      egressSipTrmDescr: "",
      ingressSipInterfaceName: "Internal",
      ingressIpGroupName: svcProxyGroup,
      egressSipInterfaceName: "Internal",
      egressIpGroupName: pstnProxyIpGroup,
      ...EMPTY_RTP,
    };

    // Record 4: PSTN STOP — RTP present, Gamma carrier on egress
    const pstnStop = {
      recordType: "STOP",
      productName: pstnSbcName,
      setupTime: formatTime(callStartMs + randomInt(5, 50)),
      globalSessionId,
      sessionId: genSessionId(),
      isSuccess: "yes",
      connectTimeUTC: formatTime(connectMs - randomInt(1, 30)),
      releaseTimeUTC: formatTime(releaseMs - randomInt(1, 100)),
      timeToConnect: tToConnect - randomInt(1, 15),
      callDuration: callDuration - randomInt(1, 15),
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: proxyModule.sbc1RoutingIp,
      egressCallDestIp: gammaSigIp,
      ingressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressCallId: svcEgressCallId,
      egressCallId: pstnEgressCallId,
      egressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressSipTrmReason: "BYE",
      ingressSipTrmDescr: "",
      egressSipTrmReason: "BYE",
      egressSipTrmDescr: "",
      ingressSipInterfaceName: "Internal",
      ingressIpGroupName: "Proxy",
      egressSipInterfaceName: "Gamma",
      egressIpGroupName: "Gamma",
      ...rtpBlock(pstnIntRtp, svcIntRtp, externalRtpIp(pstnModule.sbc1RoutingIp), gammaMediaIp),
      egressUser: "",
      egressService: "",
      ingressUser: "",
      ingressService: "",
      pstnClientTag: serviceAsset.ipGroupName,
    };

    return [svcAttempt, svcStop, proxyStop, pstnStop];
  };

  // ── SCENARIO 2 — PSTN → Service (isSuccess=false = failed call variant) ────
  // Flow: PSTN01 → (Kamailio) → PSTN01 → PROXY01 → SVC01  (4 CDR records)
  // Failed variant: only 1 CDR record (PSTN ATTEMPT with 404 termination)
  const genPstnToServiceCdrs = async (serviceAsset, intervalMs, isSuccess = true) => {
    const callingNumber = pickRandomUkMobile();
    const calledNumber = `+${serviceAsset.ddis[randomInt(0, serviceAsset.ddis.length - 1)]}`;
    const callStartMs = intervalMs + randomInt(0, 899000);
    const callDuration = isSuccess ? randomInt(4000, 46000) : -1;
    const tToConnect = isSuccess ? randomInt(100, 500) : 0;
    const connectMs = callStartMs + tToConnect;
    const releaseMs = isSuccess ? connectMs + callDuration * 10 : callStartMs + randomInt(50, 200);
    const globalSessionId = await genId(16);
    const svcSbcName = shortName(serviceAsset.sbcName1);
    const pstnIngressCallId = `${randomInt(100000000, 999999999)}_${randomInt(10000000, 99999999)}@${gammaSigIp}`;
    const pstnEgressCallId = genCallId(pstnModule.sbc1Ip);
    const svcEgressCallId = genCallId(serviceAsset.sbc1Ip);
    const sharedPstnSessionId = genSessionId();
    const svcSigIp = serviceAsset.sbc1Ip;
    const svcSvcRtp = ipInc(serviceAsset.sbc1Ip);
    const svcIntRtp = ipInc(serviceAsset.sbc1RoutingIp);
    const pstnIntRtp = ipInc(pstnModule.sbc1RoutingIp);
    const svcSipIface = getSipInterfaceName(serviceAsset.serviceType);
    const svcProxyGroup = deriveProxyIpGroup(serviceAsset.sbcName1);

    // Record 1: PSTN ATTEMPT — Kamailio redirect (or failed termination)
    const pstnAttempt = {
      recordType: "ATTEMPT",
      productName: pstnSbcName,
      setupTime: formatTime(callStartMs),
      globalSessionId,
      sessionId: sharedPstnSessionId,
      isSuccess: isSuccess ? "yes" : "no",
      connectTimeUTC: "",
      releaseTimeUTC: formatTime(callStartMs + randomInt(50, 200)),
      timeToConnect: 0,
      callDuration: -1,
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: gammaSigIp,
      egressCallDestIp: kamailioIp,
      ingressTrmReason: isSuccess ? "" : "GWAPP_UNASSIGNED_NUMBER",
      ingressCallId: pstnIngressCallId,
      egressCallId: pstnEgressCallId,
      egressTrmReason: isSuccess ? "RELEASE_BECAUSE_FORWARD" : "GWAPP_UNASSIGNED_NUMBER",
      ingressSipTrmReason: isSuccess ? "" : "404",
      ingressSipTrmDescr: isSuccess
        ? ""
        : `SIP ;cause=404 ;text="Caller with TO ${calledNumber} not found in datab"`,
      egressSipTrmReason: isSuccess ? "302" : "404",
      egressSipTrmDescr: isSuccess
        ? `SIP ;cause=302 ;text="{302 Moved Temporarily}"`
        : `SIP ;cause=404 ;text="Caller with TO ${calledNumber} not found in datab"`,
      ingressSipInterfaceName: "Gamma",
      ingressIpGroupName: "Gamma",
      egressSipInterfaceName: "Internal",
      egressIpGroupName: "Kamailio_Redirect",
      ...EMPTY_RTP,
      egressUser: "",
      egressService: "",
      ingressUser: "",
      ingressService: "",
      pstnClientTag: serviceAsset.ipGroupName,
    };

    if (!isSuccess) return [pstnAttempt]; // failed call: single ATTEMPT record only

    // Record 2: PSTN STOP — actual call leg (RTP present)
    const pstnStop = {
      recordType: "STOP",
      productName: pstnSbcName,
      setupTime: formatTime(callStartMs),
      globalSessionId,
      sessionId: sharedPstnSessionId,
      isSuccess: "yes",
      connectTimeUTC: formatTime(connectMs),
      releaseTimeUTC: formatTime(releaseMs),
      timeToConnect: tToConnect,
      callDuration,
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: gammaSigIp,
      egressCallDestIp: proxyModule.sbc1RoutingIp,
      ingressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressCallId: pstnIngressCallId,
      egressCallId: pstnEgressCallId,
      egressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressSipTrmReason: "BYE",
      ingressSipTrmDescr: "",
      egressSipTrmReason: "BYE",
      egressSipTrmDescr: "",
      ingressSipInterfaceName: "Gamma",
      ingressIpGroupName: "Gamma",
      egressSipInterfaceName: "Internal",
      egressIpGroupName: "Proxy",
      ...rtpBlock(externalRtpIp(pstnModule.sbc1RoutingIp), gammaMediaIp, pstnIntRtp, svcIntRtp),
      egressUser: "",
      egressService: "",
      ingressUser: "",
      ingressService: "",
      pstnClientTag: serviceAsset.ipGroupName,
    };

    // Record 3: PROXY STOP — SIP only, no RTP
    const proxyStop = {
      recordType: "STOP",
      productName: proxySbcName,
      setupTime: formatTime(callStartMs + randomInt(5, 30)),
      globalSessionId,
      sessionId: genSessionId(),
      isSuccess: "yes",
      connectTimeUTC: formatTime(connectMs - randomInt(1, 20)),
      releaseTimeUTC: formatTime(releaseMs - randomInt(1, 100)),
      timeToConnect: tToConnect - randomInt(1, 10),
      callDuration: callDuration - randomInt(1, 10),
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: pstnModule.sbc1RoutingIp,
      egressCallDestIp: serviceAsset.sbc1RoutingIp,
      ingressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressCallId: pstnEgressCallId,
      egressCallId: pstnEgressCallId,
      egressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressSipTrmReason: "BYE",
      ingressSipTrmDescr: "",
      egressSipTrmReason: "BYE",
      egressSipTrmDescr: "",
      ingressSipInterfaceName: "Internal",
      ingressIpGroupName: pstnProxyIpGroup,
      egressSipInterfaceName: "Internal",
      egressIpGroupName: svcProxyGroup,
      ...EMPTY_RTP,
    };

    // Record 4: SERVICE STOP — RTP present, service on egress
    const svcStop = {
      recordType: "STOP",
      productName: svcSbcName,
      setupTime: formatTime(callStartMs + randomInt(5, 50)),
      globalSessionId,
      sessionId: genSessionId(),
      isSuccess: "yes",
      connectTimeUTC: formatTime(connectMs - randomInt(1, 30)),
      releaseTimeUTC: formatTime(releaseMs - randomInt(1, 100)),
      timeToConnect: tToConnect - randomInt(1, 15),
      callDuration: callDuration - randomInt(1, 15),
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: proxyModule.sbc1RoutingIp,
      egressCallDestIp: svcSigIp,
      ingressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressCallId: pstnEgressCallId,
      egressCallId: svcEgressCallId,
      egressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressSipTrmReason: "BYE",
      ingressSipTrmDescr: "",
      egressSipTrmReason: "BYE",
      egressSipTrmDescr: "",
      ingressSipInterfaceName: "Internal",
      ingressIpGroupName: "Proxy",
      egressSipInterfaceName: svcSipIface,
      egressIpGroupName: serviceAsset.ipGroupName,
      ...rtpBlock(svcIntRtp, pstnIntRtp, svcSvcRtp, svcSigIp),
      egressUser: calledNumber,
      egressService: serviceAsset.serviceType,
      ingressUser: "",
      ingressService: "",
      egressServiceTenantTag: serviceAsset.ipGroupName,
      ingressServiceTenantTag: "",
    };

    return [pstnAttempt, pstnStop, proxyStop, svcStop];
  };

  // ── SCENARIO 3 — Service → Service ────────────────────────────────────────
  // Flow: SRC01 → (Kamailio) → SRC01 → PROXY01 → DST01  (4 CDR records)
  const genServiceToServiceCdrs = async (srcAsset, dstAsset, intervalMs) => {
    const callingNumber = `+${srcAsset.ddis[randomInt(0, srcAsset.ddis.length - 1)]}`;
    const calledNumber = `+${dstAsset.ddis[randomInt(0, dstAsset.ddis.length - 1)]}`;
    const callStartMs = intervalMs + randomInt(0, 899000);
    const callDuration = randomInt(4000, 46000);
    const tToConnect = randomInt(100, 500);
    const connectMs = callStartMs + tToConnect;
    const releaseMs = connectMs + callDuration * 10;
    const globalSessionId = await genId(16);
    const srcSbcName = shortName(srcAsset.sbcName1);
    const dstSbcName = shortName(dstAsset.sbcName1);
    const callEndGuid = randomUUID();
    const srcIngressCallId = randomUUID();
    const srcEgressCallId = genCallId(srcAsset.sbc1RoutingIp);
    const dstEgressCallId = isTeams(dstAsset.serviceType)
      ? `${randomInt(100000000, 999999999)}${Date.now()}@${dstAsset.ipGroupName.replace(/^Teams_/, "")}.emeap1dev.clouducx-cs-devpp.com`
      : genCallId(dstAsset.sbc1RoutingIp);
    const sharedSessionId = genSessionId();
    const srcSigIp = srcAsset.sbc1Ip;
    const srcSvcRtp = ipInc(srcAsset.sbc1Ip);
    const srcIntRtp = ipInc(srcAsset.sbc1RoutingIp);
    const dstSigIp = dstAsset.sbc1Ip;
    const dstIntRtp = ipInc(dstAsset.sbc1RoutingIp);
    const srcSipIface = getSipInterfaceName(srcAsset.serviceType);
    const dstSipIface = getSipInterfaceName(dstAsset.serviceType);
    const srcProxyGroup = deriveProxyIpGroup(srcAsset.sbcName1);
    const dstProxyGroup = deriveProxyIpGroup(dstAsset.sbcName1);
    const dstTenantTag = isTeams(dstAsset.serviceType)
      ? dstAsset.ipGroupName.replace(/^Teams_/, "")
      : dstAsset.ipGroupName;

    // Record 1: SOURCE ATTEMPT — Kamailio redirect (no RTP)
    const srcAttempt = {
      recordType: "ATTEMPT",
      productName: srcSbcName,
      setupTime: formatTime(callStartMs),
      globalSessionId,
      sessionId: sharedSessionId,
      isSuccess: "yes",
      connectTimeUTC: "",
      releaseTimeUTC: formatTime(callStartMs + randomInt(10, 100)),
      timeToConnect: 0,
      callDuration: -1,
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: srcSigIp,
      egressCallDestIp: kamailioIp,
      ingressTrmReason: "",
      ingressCallId: srcIngressCallId,
      egressCallId: srcEgressCallId,
      egressTrmReason: "RELEASE_BECAUSE_FORWARD",
      ingressSipTrmReason: "",
      ingressSipTrmDescr: "",
      egressSipTrmReason: "302",
      egressSipTrmDescr: `SIP ;cause=302 ;text="{302 Moved Temporarily}"`,
      ingressSipInterfaceName: srcSipIface,
      ingressIpGroupName: srcAsset.ipGroupName,
      egressSipInterfaceName: "Internal",
      egressIpGroupName: "Kamailio_Redirect",
      ...EMPTY_RTP,
      egressUser: "",
      egressService: "",
      ingressUser: callingNumber,
      ingressService: srcAsset.serviceType,
      egressServiceTenantTag: "",
      ingressServiceTenantTag: srcAsset.ipGroupName,
    };

    // Record 2: SOURCE STOP — actual call leg (RTP present)
    const srcStop = {
      recordType: "STOP",
      productName: srcSbcName,
      setupTime: formatTime(callStartMs),
      globalSessionId,
      sessionId: sharedSessionId,
      isSuccess: "yes",
      connectTimeUTC: formatTime(connectMs),
      releaseTimeUTC: formatTime(releaseMs),
      timeToConnect: tToConnect,
      callDuration,
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: srcSigIp,
      egressCallDestIp: proxyModule.sbc1RoutingIp,
      ingressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressCallId: srcIngressCallId,
      egressCallId: srcEgressCallId,
      egressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressSipTrmReason: "BYE",
      ingressSipTrmDescr: `Q.850 ;cause=16 ;text="${callEndGuid};CallEndRe"`,
      egressSipTrmReason: "BYE",
      egressSipTrmDescr: `Q.850 ;cause=16 ;text="${callEndGuid};CallEndRe"`,
      ingressSipInterfaceName: srcSipIface,
      ingressIpGroupName: srcAsset.ipGroupName,
      egressSipInterfaceName: "Internal",
      egressIpGroupName: "Proxy",
      ...rtpBlock(srcSvcRtp, srcSigIp, srcIntRtp, dstIntRtp),
      egressUser: "",
      egressService: "",
      ingressUser: callingNumber,
      ingressService: srcAsset.serviceType,
      egressServiceTenantTag: "",
      ingressServiceTenantTag: srcAsset.ipGroupName,
    };

    // Record 3: PROXY STOP — SIP only, no RTP
    const proxyStop = {
      recordType: "STOP",
      productName: proxySbcName,
      setupTime: formatTime(callStartMs + randomInt(5, 30)),
      globalSessionId,
      sessionId: genSessionId(),
      isSuccess: "yes",
      connectTimeUTC: formatTime(connectMs - randomInt(1, 20)),
      releaseTimeUTC: formatTime(releaseMs - randomInt(1, 100)),
      timeToConnect: tToConnect - randomInt(1, 10),
      callDuration: callDuration - randomInt(1, 10),
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: srcAsset.sbc1RoutingIp,
      egressCallDestIp: dstAsset.sbc1RoutingIp,
      ingressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressCallId: srcEgressCallId,
      egressCallId: srcEgressCallId,
      egressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressSipTrmReason: "BYE",
      ingressSipTrmDescr: `Q.850 ;cause=16 ;text="${callEndGuid};CallEndRe"`,
      egressSipTrmReason: "BYE",
      egressSipTrmDescr: `Q.850 ;cause=16 ;text="${callEndGuid};CallEndRe"`,
      ingressSipInterfaceName: "Internal",
      ingressIpGroupName: srcProxyGroup,
      egressSipInterfaceName: "Internal",
      egressIpGroupName: dstProxyGroup,
      ...EMPTY_RTP,
    };

    // Record 4: DESTINATION STOP — RTP present, destination service on egress
    const dstStop = {
      recordType: "STOP",
      productName: dstSbcName,
      setupTime: formatTime(callStartMs + randomInt(5, 50)),
      globalSessionId,
      sessionId: genSessionId(),
      isSuccess: "yes",
      connectTimeUTC: formatTime(connectMs - randomInt(1, 30)),
      releaseTimeUTC: formatTime(releaseMs - randomInt(1, 100)),
      timeToConnect: tToConnect - randomInt(1, 15),
      callDuration: callDuration - randomInt(1, 15),
      timeZone: "UTC",
      callingUserBeforeManipulation: callingNumber,
      callingUserAfterManipulation: callingNumber,
      calledUserBeforeManipulation: calledNumber,
      calledUserAfterManipulation: calledNumber,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp: proxyModule.sbc1RoutingIp,
      egressCallDestIp: dstSigIp,
      ingressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressCallId: srcEgressCallId,
      egressCallId: dstEgressCallId,
      egressTrmReason: "GWAPP_NORMAL_CALL_CLEAR",
      ingressSipTrmReason: "BYE",
      ingressSipTrmDescr: `Q.850 ;cause=16 ;text="${callEndGuid};CallEndRe"`,
      egressSipTrmReason: "BYE",
      egressSipTrmDescr: `Q.850 ;cause=16 ;text="${callEndGuid};CallEndRe"`,
      ingressSipInterfaceName: "Internal",
      ingressIpGroupName: "Proxy",
      egressSipInterfaceName: dstSipIface,
      egressIpGroupName: dstAsset.ipGroupName,
      ...rtpBlock(dstIntRtp, srcIntRtp, externalRtpIp(dstAsset.sbc1RoutingIp), ipInc(dstSigIp)),
      egressUser: calledNumber,
      egressService: dstAsset.serviceType,
      ingressUser: "",
      ingressService: "",
      egressServiceTenantTag: dstTenantTag,
      ingressServiceTenantTag: "",
      ...(isTeams(dstAsset.serviceType) && {
        egressVendorOriginContactId: `<sip:api-du-a-euno.pstnhub.microsoft.com:443;x-i=${randomUUID()};x-c=${randomUUID().replace(/-/g, "")}/s/1/${randomUUID().replace(/-/g, "")}>`,
        ingressVendorOriginContactId: "",
      }),
    };

    return [srcAttempt, srcStop, proxyStop, dstStop];
  };

  // ── Interval loop ──────────────────────────────────────────────────────────
  const timeIncrementsMs = 900000;
  let currentInterval = dateFrom;
  let totalSubmitted = 0;
  let errors = 0;

  while (currentInterval <= dateTo) {
    const intervalHour = new Date(currentInterval).getUTCHours();
    if (intervalHour < 8 || intervalHour >= 18) {
      currentInterval += timeIncrementsMs;
      console.log(
        `Skipping interval starting at ${new Date(currentInterval).toISOString()} (outside business hours)`,
      );
      continue;
    }
    const intervalLabel = new Date(currentInterval).toISOString();
    console.log(`Generating CDRs for interval starting at ${intervalLabel}`);

    // ── Process all assets in parallel for this interval ──────────────────────
    const intervalResults = await Promise.all(
      mtAssets.map(async (serviceAsset) => {
        let assetSubmitted = 0;
        let assetErrors = 0;

        // ── success: cycle Service→PSTN / PSTN→Service / Service→Service ──────
        for (let i = 0; i < successRecordsPerInterval; i++) {
          try {
            let cdrs;
            switch (i % 3) {
              case 0:
                cdrs = await genServiceToPstnCdrs(serviceAsset, currentInterval);
                break;
              case 1:
                cdrs = await genPstnToServiceCdrs(serviceAsset, currentInterval, true);
                break;
              default: {
                const otherAssets = mtAssets.filter((a) => a !== serviceAsset);
                const dstAsset =
                  otherAssets.length > 0 ? otherAssets[randomInt(0, otherAssets.length - 1)] : null;
                cdrs = dstAsset
                  ? await genServiceToServiceCdrs(serviceAsset, dstAsset, currentInterval)
                  : await genServiceToPstnCdrs(serviceAsset, currentInterval);
              }
            }
            for (const cdr of cdrs) {
              const outcome = await postKpisToPipeline(process.env.dataPrepperAuth, cdr, "sbcCdr");
              if (outcome.statusCode !== 200) {
                assetErrors++;
                console.log(`CDR pipeline error: ${JSON.stringify(outcome.body)}`);
              } else {
                assetSubmitted++;
              }
            }
          } catch (err) {
            assetErrors++;
            console.log(`Error generating success CDR: ${err.message}`);
          }
        }

        // ── failure: PSTN→Service with 404 termination (single ATTEMPT record) ─
        for (let i = 0; i < failedRecordsPerInterval; i++) {
          try {
            const cdrs = await genPstnToServiceCdrs(serviceAsset, currentInterval, false);
            for (const cdr of cdrs) {
              const outcome = await postKpisToPipeline(process.env.dataPrepperAuth, cdr, "sbcCdr");
              if (outcome.statusCode !== 200) {
                assetErrors++;
                console.log(`CDR pipeline error: ${JSON.stringify(outcome.body)}`);
              } else {
                assetSubmitted++;
              }
            }
          } catch (err) {
            assetErrors++;
            console.log(`Error generating failed CDR: ${err.message}`);
          }
        }

        return { assetSubmitted, assetErrors };
      }),
    );

    // ── Aggregate per-asset counters ──────────────────────────────────────────
    for (const { assetSubmitted, assetErrors } of intervalResults) {
      totalSubmitted += assetSubmitted;
      errors += assetErrors;
    }

    currentInterval += timeIncrementsMs;
  }

  res.status(200).send({
    status: "success",
    data: `CDR records submitted: ${totalSubmitted}, errors: ${errors}`,
  });
});

export const generateKpiDataAuto = catchAsync(async (req, res, next) => {
  let { dateFrom, dateTo, customerUuid, quality } = req.body;
  if (dateFrom === undefined || dateTo === undefined || !customerUuid) {
    return next(new AppError("Missing dateFrom, dateTo, or customerUuid", 400));
  }

  // Ensure values are numbers, not strings
  if (typeof dateFrom === "string") dateFrom = Number(dateFrom);
  if (typeof dateTo === "string") dateTo = Number(dateTo);
  if (Number.isNaN(dateFrom) || Number.isNaN(dateTo)) {
    return next(new AppError("dateFrom and dateTo must be valid numbers", 400));
  }

  // Support both seconds and milliseconds input (auto-detect)
  // If value is less than year 2002 in ms, treat as seconds
  if (dateFrom < 1000000000000) dateFrom = dateFrom * 1000;
  if (dateTo < 1000000000000) dateTo = dateTo * 1000;

  // Validate range: max 1 month (31 days)
  const maxRangeMs = 93 * 24 * 60 * 60 * 1000;
  if (dateTo < dateFrom) {
    return next(new AppError("dateTo must be after dateFrom", 400));
  }
  if (dateTo - dateFrom > maxRangeMs) {
    return next(new AppError("Time range cannot exceed 93 days", 400));
  }

  // Fetch all MT and Dedicated assets for the customer
  const mtAssets = await getMTassets(customerUuid);
  if (mtAssets instanceof Error) {
    return next(
      new AppError(`Error fetching Multitenant assets from database: ${mtAssets.message}`, 500),
    );
  }
  const formattedMtAssets = splitAndFormatMtAssets(mtAssets);

  const dedicatedAssets = await getDedicatedAssets(customerUuid);
  if (dedicatedAssets instanceof Error) {
    return next(
      new AppError(
        `Error fetching Dedicated assets from database: ${dedicatedAssets.message}`,
        500,
      ),
    );
  }

  // Merge and clean assets
  let assets = [...formattedMtAssets, ...dedicatedAssets]
    .map((asset) => ({
      ...asset,
      ipGroupNames: Array.isArray(asset.ipGroupNames)
        ? asset.ipGroupNames.filter((ipg) => ipg != null)
        : [],
    }))
    .filter((asset) => asset.ipGroupNames.length > 0);

  if (!assets || assets.length === 0) {
    return next(new AppError("No assets found for customer", 404));
  }

  // Assign random quality to each asset: "poor", "medium", "good"
  const qualities = quality ? quality : ["poor", "medium", "good"];
  assets = assets.map((asset) => ({
    ...asset,
    quality: qualities[Math.floor(Math.random() * qualities.length)],
  }));

  // Calculate number of intervals (no array allocation)
  const timeIncrementsMs = 900000;
  // Use BigInt for safe calculation
  const dateFromBig = BigInt(dateFrom);
  const dateToBig = BigInt(dateTo);
  const timeIncrementsMsBig = BigInt(timeIncrementsMs);
  const intervalCount = Number((dateToBig - dateFromBig) / timeIncrementsMsBig) + 1;
  if (intervalCount > 7000) {
    return next(
      new AppError(
        `Too many intervals requested (${intervalCount}). Reduce time range or increase interval size.`,
        400,
      ),
    );
  }

  // Use the same random generators as generateKpiData
  const randomInteger = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const randomDecimalInteger = (min, max, decimalPlaces) =>
    (Math.random() * (max - min) + min).toFixed(decimalPlaces) * 1;

  // Efficiently loop over intervals without allocating a large array
  for (let i = 0; i < intervalCount; i++) {
    // Use BigInt to avoid overflow, then convert back to Number
    const _interval = Number(dateFromBig + BigInt(i) * timeIncrementsMsBig);

    const hour = new Date(_interval).getUTCHours();

    if (hour >= 8 && hour <= 17) {
      await Promise.all(
        assets.map(async (_asset) => {
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
                  establishedCallsIn: randomInteger(0, 10000),
                  establishedCallsOut: randomInteger(0, 10000),
                };
              }),
            };
            console.log(
              `Processing asset ${_asset.sbcName} for interval ${new Date(_interval).toISOString()}`,
            );

            const postToPipelineOutcome = await postKpisToPipeline(
              process.env.dataPrepperAuth,
              body,
              "kpi",
            );

            if (postToPipelineOutcome.statusCode !== 200) {
              console.log(
                `ERROR: Processing asset ${_asset.sbcName}. ERR - ${postToPipelineOutcome.body}`,
              );
            }
          } catch (error) {
            console.log(error);
          }
        }),
      );
    } else {
      console.log(
        `Skipping interval ${new Date(_interval).toISOString()} due to off-peak hour (${hour}h)`,
      );
    }
  }

  res.status(200).send({ status: "success", data: "KPI data submitted for all assets." });
});

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
    }),
  ).min(1, "Expected at lease 1 asset to be supplied in the request");

  try {
    await assetSchema.validate(customerAssets);
  } catch (err) {
    return next(
      new AppError(
        `ERROR: Supplied body has incorrect format: ERR - ${err.errors}`,
        500,
        `ERROR: Supplied body has incorrect format: ERR - ${err.errors}`,
      ),
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
            "kpi",
          );

          if (postToPipelineOutcome.statusCode !== 200) {
            console.log(
              `ERROR: Processing asset ${_asset.serviceType}. ERR - ${postToPipelineOutcome.body}`,
            );
          }
        } catch (error) {
          console.log(error);
        }
      }),
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
    status: string().oneOf(["success", "fail"]).required(),
    sbcNames: array().required().min(1, "At least 1 SBC name must be provided"),
    services: array(
      object({
        ipGroup: string().required(),
        numberRangeFrom: number().required(),
        numberRangeTo: number().required(),
      }),
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
        `ERROR: Supplied body has incorrect format: ERR - ${err.errors}`,
      ),
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

  const generateCdr = async (data, intervalMs) => {
    const callDirection = callDirections[randomInteger(0, callDirections.length - 1)];
    const callDuration = randomInteger(3000, 36000);
    const callConnectObj = new Date(intervalMs);
    const callReleaseObj = new Date(intervalMs + callDuration * 10);

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
          data.pstn.numberRangeTo,
        )}`;
        directionBaseData.callingUserAfterManipulation =
          directionBaseData.callingUserBeforeManipulation;
        directionBaseData.calledUserBeforeManipulation = `+${randomInteger(
          data.services[dstServiceIndex].numberRangeFrom,
          data.services[dstServiceIndex].numberRangeTo,
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
          },
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
          },
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
          },
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
          data.services[srcServiceIndex].numberRangeTo,
        )}`;
        directionBaseData.callingUserAfterManipulation =
          directionBaseData.callingUserBeforeManipulation;
        directionBaseData.calledUserBeforeManipulation = `+${randomInteger(
          data.pstn.numberRangeFrom,
          data.pstn.numberRangeTo,
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
          },
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
          },
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
          },
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
      recordType: data.status === "success" ? "STOP" : "ATTEMPT",
      productName: data.sbcNames[randomInteger(0, data.sbcNames.length - 1)],
      setupTime,
      globalSessionId: await generateRandomId(16),
      sessionId: await generateRandomId(12),
      isSuccess: data.status === "success" ? "yes" : "no",
      connectTimeUTC,
      releaseTimeUTC: data.status === "success" ? releaseTimeUTC : undefined,
      timeToConnect: data.status === "success" ? randomInteger(100, 300) : undefined,
      callDuration: data.status === "success" ? callDuration : 0,
      timeZone: "UTC",
      callingUserBeforeManipulation,
      callingUserAfterManipulation,
      calledUserBeforeManipulation,
      calledUserAfterManipulation,
      ingressCallOrigin: "in",
      egressCallOrigin: "out",
      ingressCallSourceIp,
      egressCallDestIp,
      ingressTrmReason:
        data.status === "success" ? "GWAPP_NORMAL_CALL_CLEAR" : "GWAPP_UNASSIGNED_NUMBER",
      ingressCallId: randomUUID(),
      egressCallId: randomUUID(),
      egressTrmReason:
        data.status === "success" ? "GWAPP_NORMAL_CALL_CLEAR" : "GWAPP_UNASSIGNED_NUMBER",
      ingressSipTrmReason: data.status === "success" ? "BYE" : "604",
      ingressSipTrmDescr:
        data.status === "success"
          ? `Q.850" ;cause=16`
          : `SIP ;cause=604 ;text="{604 Does Not Exist Anywhere}"`,
      egressSipTrmReason: data.status === "success" ? "BYE" : "604",
      egressSipTrmDescr:
        data.status === "success"
          ? `Q.850 ;cause=16`
          : `SIP ;cause=604 ;text="{604 Does Not Exist Anywhere}"`,
      ingressSipInterfaceName,
      ingressIpGroupName,
      egressSipInterfaceName,
      egressIpGroupName,
      ingressLocalRtpIp,
      ingressLocalRtpPort: data.status === "success" ? randomInteger(6000, 65535) : undefined,
      ingressRemoteRtpIp,
      ingressRemoteRtpPort: data.status === "success" ? randomInteger(25000, 65535) : undefined,
      egressLocalRtpIp,
      egressLocalRtpPort: data.status === "success" ? randomInteger(6000, 65535) : undefined,
      egressRemoteRtpIp,
      egressRemoteRtpPort: data.status === "success" ? randomInteger(25000, 65535) : undefined,
      ingressCodec: data.status === "success" ? "g711Alaw64k" : undefined,
      egressCodec: data.status === "success" ? "g711Alaw64k" : undefined,
      ingressPacketLoss: data.status === "success" ? randomDecimalInteger(0, 1.5, 1) : undefined,
      egressPacketLoss: data.status === "success" ? randomDecimalInteger(0, 1.5, 1) : undefined,
      ingressLocalPacketLoss:
        data.status === "success" ? randomDecimalInteger(0, 1.5, 1) : undefined,
      egressLocalPacketLoss:
        data.status === "success" ? randomDecimalInteger(0, 1.5, 1) : undefined,
      ingressLocalJitter: data.status === "success" ? randomDecimalInteger(0, 15, 1) : undefined,
      ingressRemoteJitter: data.status === "success" ? randomDecimalInteger(0, 15, 1) : undefined,
      egressLocalJitter: data.status === "success" ? randomDecimalInteger(0, 15, 1) : undefined,
      egressRemoteJitter: data.status === "success" ? randomDecimalInteger(0, 15, 1) : undefined,
      ingressLocalMos: data.status === "success" ? randomDecimalInteger(40, 42) : undefined,
      ingressRemoteMos: data.status === "success" ? randomDecimalInteger(40, 42) : undefined,
      egressLocalMos: data.status === "success" ? randomDecimalInteger(40, 42) : undefined,
      egressRemoteMos: data.status === "success" ? randomDecimalInteger(40, 42) : undefined,
      ingressLocalRoudTripDelay: data.status === "success" ? 0 : undefined,
      ingressRemoteRoudTripDelay: data.status === "success" ? 0 : undefined,
      egressLocalRoudTripDelay: data.status === "success" ? 0 : undefined,
      egressRemoteRoudTripDelay: data.status === "success" ? 0 : undefined,
      ingressUser: "",
      ingressService: "",
      egressUser: "",
      egressService: "",
      egressLocalInputPackets: data.status === "success" ? 369 : undefined,
      egressLocalOutputPackets: data.status === "success" ? 355 : undefined,
      ingressLocalInputPackets: data.status === "success" ? 355 : undefined,
      ingressLocalOutputPackets: data.status === "success" ? 369 : undefined,
    };
  };

  // Date ranges from 00:00 to 23:59 of current date
  const range = {
    todayStart: new Date(new Date().setUTCHours(9, 0, 0, 0)).getTime(),
    todayEnd: new Date(new Date().setUTCHours(17, 0, 0, 0)).getTime(),
  };
  console.log(range);
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
        const body = await generateCdr(cdrData, _interval);

        const postToPipelineOutcome = await postKpisToPipeline(
          process.env.dataPrepperAuth,
          body,
          "sbcCdr",
        );

        if (postToPipelineOutcome.statusCode !== 200) {
          console.log(
            `ERROR: Failed to poast cdr records to pipeline- ERR: ${JSON.stringify(
              postToPipelineOutcome.body,
            )}`,
          );
        }
      } catch (error) {
        console.log(error);
      }
    }
  }

  res.status(200).send(`CDR data generated and submitted to pipeline`);
});

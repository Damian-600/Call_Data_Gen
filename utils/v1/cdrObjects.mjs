import util from "node:util";
import { randomBytes as randomBytesCb } from "node:crypto";

export class CdrSchema {
  constructor(cdrData) {
    this.recordType = cdrData.recordType;
    this.productName = cdrData.productName;
    this.setupTime = cdrData.setupTime;
    this.globalSessionId = this.generateRandomId(16);
    this.sessionId = this.generateRandomId(16);
    this.isSuccess = cdrData.isSuccess;
    this.connectTimeUTC = cdrData.connectTimeUTC;
    this.releaseTimeUTC = cdrData.releaseTimeUTC;
    this.timeToConnect = 285; // 100 - 285
    this.callDuration = cdrData.callDuration; //400, 3600
    this.timeZone = cdrData.timeZone;
    this.callingUserBeforeManipulation = cdrData.callingUserBeforeManipulation;
    this.callingUserAfterManipulation = cdrData.callingUserAfterManipulation;
    this.calledUserBeforeManipulation = cdrData.calledUserBeforeManipulation;
    this.calledUserAfterManipulation = cdrData.calledUserAfterManipulation;
    this.ingressCallOrigin = cdrData.ingressCallOrigin;
    this.egressCallOrigin = cdrData.egressCallOrigin;
    this.ingressCallSourceIp = cdrData.ingressCallSourceIp;
    this.egressCallDestIp = cdrData.egressCallDestIp;
    this.ingressTrmReason = cdrData.ingressTrmReason;
    this.ingressCallId = cdrData.ingressCallId;
    this.egressCallId = cdrData.egressCallId;
    this.egressTrmReason = cdrData.egressTrmReason;
    this.ingressSipTrmReason = cdrData.ingressSipTrmReason;
    this.ingressSipTrmDescr = cdrData.ingressSipTrmDescr;
    this.egressSipTrmReason = cdrData.egressSipTrmReason;
    this.egressSipTrmDescr = cdrData.egressSipTrmDescr;
    this.ingressSipInterfaceName = cdrData.ingressSipInterfaceName;
    this.ingressIpGroupName = cdrData.ingressIpGroupName;
    this.egressSipInterfaceName = cdrData.egressSipInterfaceName;
    this.egressIpGroupName = cdrData.egressIpGroupName;
    this.ingressLocalRtpIp = cdrData.ingressLocalRtpIp;
    this.ingressLocalRtpPort = cdrData.ingressLocalRtpPort;
    this.ingressRemoteRtpIp = cdrData.ingressRemoteRtpIp;
    this.ingressRemoteRtpPort = cdrData.ingressRemoteRtpPort;
    this.egressLocalRtpIp = cdrData.egressLocalRtpIp;
    this.egressLocalRtpPort = cdrData.egressLocalRtpPort;
    this.egressRemoteRtpIp = cdrData.egressRemoteRtpIp;
    this.egressRemoteRtpPort = cdrData.egressRemoteRtpPort;
    this.ingressCodec = cdrData.ingressCodec;
    this.egressCodec = cdrData.egressCodec;
    this.ingressPacketLoss = cdrData.ingressPacketLoss;
    this.egressPacketLoss = cdrData.egressPacketLoss;
    this.ingressLocalPacketLoss = cdrData.ingressLocalPacketLoss;
    this.egressLocalPacketLoss = cdrData.egressLocalPacketLoss;
    this.ingressLocalJitter = cdrData.ingressLocalJitter;
    this.ingressRemoteJitter = cdrData.ingressRemoteJitter;
    this.egressLocalJitter = cdrData.egressLocalJitter;
    this.egressRemoteJitter = cdrData.egressRemoteJitter;
    this.ingressLocalMos = cdrData.ingressLocalMos;
    this.ingressRemoteMos = cdrData.ingressRemoteMos;
    this.egressLocalMos = cdrData.egressLocalMos;
    this.egressRemoteMos = cdrData.egressRemoteMos;
    this.ingressLocalRoudTripDelay = cdrData.ingressLocalRoudTripDelay;
    this.ingressRemoteRoudTripDelay = cdrData.ingressRemoteRoudTripDelay;
    this.egressLocalRoudTripDelay = cdrData.egressLocalRoudTripDelay;
    this.egressRemoteRoudTripDelay = cdrData.egressRemoteRoudTripDelay;
    this.ingressUser = cdrData.ingressUser;
    this.ingressService = cdrData.ingressService;
    this.egressUser = cdrData.egressUser;
    this.egressService = cdrData.egressService;
    this.pstnClientTag = cdrData.pstnClientTag;
    this.isRecorded = cdrData.isRecorded;
  }

  generateRandomId = async (length) => {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";

    try {
      if (!length || length > 25) throw Error("Unsupported length value");

      // Promisify randomByte method to avoid call backs
      const randomByte = util.promisify(randomBytesCb);
      const bytes = randomByte(length);

      for (let i = 0; i < length; i++) {
        result += chars[bytes[i] % chars.length];
      }
      console.log(result);
      return result;
    } catch (err) {
      return undefined;
    }
  };
}

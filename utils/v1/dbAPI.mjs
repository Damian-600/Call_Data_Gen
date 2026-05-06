import sequelize from "../../sequelize.mjs";

export const getMTassets = async (customerUuid) => {
  try {
    const results = await sequelize.query(
      "SELECT 'Multitenant' AS assetType, sbc_fqdn1 as sbcName1, sbc_fqdn2 as sbcName2, mt.moduleType AS serviceType, ip1 as sbc1Ip, ip2 as sbc2Ip, int_routingIp1 as sbc1RoutingIp, int_routingIp2 as sbc2RoutingIp, JSON_ARRAYAGG(t.tenant) AS ipGroupNames \
      FROM (SELECT DISTINCT s.tenant, s.module_key, s.client_key FROM cucx_emea_db.services s) t \
      JOIN cucx_global_db.clients c \
       ON t.client_key = c.client_id \
      JOIN cucx_emea_db.modules m ON t.module_key = m.module_id \
      JOIN cucx_emea_db.module_types mt ON m.moduleType_key = mt.moduleType_id \
      WHERE c.uuid = :customerUuid \
      GROUP BY m.moduleName, mt.moduleType;",
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: { customerUuid },
      },
    );

    // If the query returns an unexpected result, return an empty array.
    if (!Array.isArray(results)) {
      return [];
    }

    // Return the calling profile values, ensuring uniqueness.
    return results;
  } catch (error) {
    return error;
  }
};

export const getDedicatedAssets = async (customerUuid) => {
  try {
    const results = await sequelize.query(
      "SELECT 'Dedicated' AS assetType, ds.sbc_name AS sbcName, JSON_ARRAYAGG(t.ip_groups) AS ipGroupNames \
        FROM ( SELECT DISTINCT dms.dedicatedModule_id, ss.ip_groups \
          FROM cucx_global_db.dedicated_modules dms \
            JOIN cucx_global_db.asset_services ats ON dms.dedicatedModule_id = ats.dedicatedModule_key \
            JOIN cucx_global_db.sbc_services ss ON ss.assetService_key = ats.assetService_id ) t \
            JOIN cucx_global_db.dedicated_sbcs ds ON t.dedicatedModule_id = ds.dedicatedModule_key \
            JOIN cucx_global_db.dedicated_modules dms ON t.dedicatedModule_id = dms.dedicatedModule_id \
            JOIN cucx_global_db.clients c ON dms.client_key = c.client_id \
            WHERE c.uuid = :customerUuid \
        GROUP BY ds.sbc_name",
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: { customerUuid },
      },
    );

    // If the query returns an unexpected result, return an empty array.
    if (!Array.isArray(results)) {
      return [];
    }

    // Return the calling profile values, ensuring uniqueness.
    return results;
  } catch (error) {
    return error;
  }
};

export const getMTassetsAndDdis = async (customerUuid) => {
  try {
    const results = await sequelize.query(
      "SELECT 'Multitenant' AS assetType, sbc_fqdn1 as sbcName1, sbc_fqdn2 as sbcName2, mt.moduleType AS serviceType, ip1 as sbc1Ip, ip2 as sbc2Ip, int_routingIp1 as sbc1RoutingIp, int_routingIp2 as sbc2RoutingIp, t.tenant AS ipGroupName, JSON_ARRAYAGG(d.ddi) AS ddis \
      FROM (SELECT DISTINCT s.tenant, s.module_key, s.client_key, s.service_id FROM cucx_emea_db.services s) t \
      JOIN cucx_global_db.clients c \
       ON t.client_key = c.client_id \
      JOIN cucx_emea_db.modules m ON t.module_key = m.module_id \
      JOIN cucx_emea_db.module_types mt ON m.moduleType_key = mt.moduleType_id \
      JOIN cucx_emea_db.ddis d ON t.service_id = d.service_key \
      WHERE c.uuid = :customerUuid \
      GROUP BY m.moduleName, mt.moduleType;",
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: { customerUuid },
      },
    );

    // If the query returns an unexpected result, return an empty array.
    if (!Array.isArray(results)) {
      return [];
    }

    // Normalise data

    results.forEach((_result) => {
      if (_result.serviceType === "Teams") {
        _result.ipGroupName = `Teams_${_result.ipGroupName}`;
      }
    });

    // Return the calling profile values, ensuring uniqueness.
    return results;
  } catch (error) {
    return error;
  }
};

export const getMTinfraModules = async (customerUuid) => {
  try {
    const results = await sequelize.query(
      "SELECT sbc_fqdn1 as sbcName1, sbc_fqdn2 as sbcName2, mt.moduleType, ip1 as sbc1Ip, ip2 as sbc2Ip, int_routingIp1 as sbc1RoutingIp, int_routingIp2 as sbc2RoutingIp FROM cucx_emea_db.modules m \
      JOIN cucx_emea_db.module_types mt ON m.moduleType_key = mt.moduleType_id \
      Where mt.moduleType = 'Proxy' or mt.moduleType = 'Pstn';",
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: { customerUuid },
      },
    );

    // If the query returns an unexpected result, return an empty array.
    if (!Array.isArray(results)) {
      return [];
    }

    // Return the calling profile values, ensuring uniqueness.
    return results;
  } catch (error) {
    return error;
  }
};

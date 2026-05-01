import sequelize from "../../sequelize.mjs";

export const getMTassets = async (customerUuid) => {
  try {
    const results = await sequelize.query(
      "SELECT 'Multitenant' AS assetType, m.moduleName AS sbcName, mt.moduleType AS serviceType, JSON_ARRAYAGG(t.tenant) AS ipGroupNames \
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

const multitenantAssets = [
  {
    assetType: "Multitenant",
    sbcName: "DEV-CE-IRL-TEAMS01",
    serviceType: "Teams",
    ipGroupNames: ["Teams_EMEAMT11"],
  },
  {
    assetType: "Multitenant",
    sbcName: "DEV-CE-LND-TEAMS01",
    serviceType: "Teams",
    ipGroupNames: ["Teams_EMEAMT11"],
  },
  {
    assetType: "Multitenant",
    sbcName: "DEV-CE-IRL-OC01",
    serviceType: "Teams_OC",
    ipGroupNames: ["9b39a2e9-3c02-4287-b125-782ee59eef2c"],
  },
  {
    assetType: "Multitenant",
    sbcName: "DEV-CE-LND-OC01",
    serviceType: "Teams_OC",
    ipGroupNames: ["9b39a2e9-3c02-4287-b125-782ee59eef2c"],
  },
  {
    assetType: "Multitenant",
    sbcName: "DEV-CE-IRL-WEBEX01",
    serviceType: "Webex_CCP",
    ipGroupNames: ["d8765eee-2af5-458e-873d-dc39d6f9c6c6"],
  },
  {
    assetType: "Multitenant",
    sbcName: "DEV-CE-LND-WEBEX01",
    serviceType: "Webex_CCP",
    ipGroupNames: ["d8765eee-2af5-458e-873d-dc39d6f9c6c6"],
  },
  {
    assetType: "Multitenant",
    sbcName: "dev-ce-irl-zoom01",
    serviceType: "Zoom Phone",
    ipGroupNames: ["GUCX_DEV"],
  },
  {
    assetType: "Multitenant",
    sbcName: "dev-ce-lnd-zoom01",
    serviceType: "Zoom Phone",
    ipGroupNames: ["GUCX_DEV"],
  },
  {
    assetType: "Multitenant",
    sbcName: "DEV-CE-IRL-ACS01",
    serviceType: "ACS",
    ipGroupNames: ["SIPP UAS"],
  },
  {
    assetType: "Multitenant",
    sbcName: "DEV-CE-LND-ACS01",
    serviceType: "ACS",
    ipGroupNames: ["SIPP UAS"],
  },
];

const dedicatedAssets = [
  {
    assetType: "Dedicated",
    sbcName: "GAM-INTEROP-TESTING-IRL-SBC01",
    ipGroupNames: ["GAM-082", "WBX-084", "TMS-102"],
  },
  {
    assetType: "Dedicated",
    sbcName: "GAM-INTEROP-TESTING-LND-SBC01",
    ipGroupNames: ["GAM-082", "WBX-084", "TMS-102"],
  },
];

// Simulate DB fetch by customer UUID
export async function fetchCustomerAssets(customerUuid) {
  // In real implementation, filter by customerUuid
  // Here, return all for demo
  return [...multitenantAssets, ...dedicatedAssets];
}

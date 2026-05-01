import sequelize from "../../sequelize.mjs";

export const getMTassets = async (customerUuid) => {
  try {
    const results = await sequelize.query(
      "SELECT 'Multitenant' AS assetType, sbc_fqdn1 as sbcName1, sbc_fqdn2 as sbcName2, mt.moduleType AS serviceType, JSON_ARRAYAGG(t.tenant) AS ipGroupNames \
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

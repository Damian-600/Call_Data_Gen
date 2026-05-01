import Sequelize from "sequelize";
import { amazonRds } from "./utils/v1/amazonRdsCaCerts.mjs";

const sequelizeGlobalDB = new Sequelize(
  process.env.dbInstanceName,
  process.env.dbUserName,
  process.env.dbPassword,
  {
    host: process.env.dbEndpoint,
    dialect: "mysql",
    dialectOptions: {
      ssl: amazonRds,
    },
    logging: false,
  },
);

sequelizeGlobalDB
  .authenticate()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`DB ${process.env.dbInstanceName} connection successful!`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`DB ${process.env.dbInstanceName} sconnection failed:`, err);
  });

export default sequelizeGlobalDB;

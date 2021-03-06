import * as fs from "fs";
import * as path from "path";
import * as winston from "winston";
import * as http from "http";
import { WebSocketClient, NoderedUtil, TokenUser } from "openflow-api";
import { Logger } from "./Logger";
import { WebServer } from "./WebServer";
import { Config } from "./Config";
import { Crypt } from "./nodeclient/Crypt";
import { FileSystemCache } from "openflow-api";
import { RestartService } from "./nodeclient/cliutil";

const logger: winston.Logger = Logger.configure();
logger.info("starting openflow nodered");

const unhandledRejection = require("unhandled-rejection");
let rejectionEmitter = unhandledRejection({
    timeout: 20
});

rejectionEmitter.on("unhandledRejection", (error, promise) => {
    console.log('Unhandled Rejection at: Promise', promise, 'reason:', error);
    console.dir(error);
    promise.catch(e => {
        console.error(e);
    });
});

rejectionEmitter.on("rejectionHandled", (error, promise) => {
    console.log('Rejection handled at: Promise', promise, 'reason:', error);
    console.dir(error);
});
let server: http.Server = null;
(async function (): Promise<void> {
    try {
        const backupStore = new FileSystemCache(path.join(Config.logpath, '.cache-' + Config.nodered_id));
        const filename: string = Config.nodered_id + "_flows.json";
        const json = await backupStore.get(filename, null);
        const socket: WebSocketClient = new WebSocketClient(logger, Config.api_ws_url);
        if (!NoderedUtil.IsNullEmpty(json) && Config.allow_start_from_cache) {
            server = await WebServer.configure(logger, socket);
            const baseurl = (!NoderedUtil.IsNullEmpty(Config.saml_baseurl) ? Config.saml_baseurl : Config.baseurl());
            logger.info("listening on " + baseurl);
        }
        socket.setCacheFolder(Config.logpath);
        socket.agent = "nodered";
        socket.version = Config.version;
        logger.info("VERSION: " + Config.version);
        socket.events.on("onerror", async () => {
        });
        socket.events.on("onclose", async () => {
        });
        socket.events.on("onopen", async () => {
            try {
                // q.clientagent = "nodered";
                // q.clientversion = Config.version;
                let jwt: string = "";
                if (Config.jwt !== "") {
                    jwt = Config.jwt;
                } else if (Crypt.encryption_key() !== "") {
                    const user = new TokenUser();
                    if (NoderedUtil.IsNullEmpty(Config.nodered_sa)) {
                        user.name = "nodered" + Config.nodered_id;
                    } else {
                        user.name = Config.nodered_sa;
                    }
                    user.username = user.name;
                    jwt = Crypt.createToken(user);
                } else {
                    throw new Error("missing encryption_key and jwt, signin not possible!");
                }
                const result = await NoderedUtil.SigninWithToken(jwt, null, null);
                logger.info("signed in as " + result.user.name + " with id " + result.user._id);
                WebSocketClient.instance.user = result.user;
                WebSocketClient.instance.jwt = result.jwt;

                if (server == null) {
                    server = await WebServer.configure(logger, socket);
                    const baseurl = (!NoderedUtil.IsNullEmpty(Config.saml_baseurl) ? Config.saml_baseurl : Config.baseurl());
                    logger.info("listening on " + baseurl);
                }
                socket.events.emit("onsignedin", result.user);
            } catch (error) {
                let closemsg: any = (error.message ? error.message : error);
                logger.error(closemsg);
                socket.close(1000, closemsg);
            }
        });
    } catch (error) {
        logger.error(error.message ? error.message : error);
    }
})();



"use strict";

const admin = require("firebase-admin");
const { spawn } = require("child_process");
const path = require("path");

async function main() {
    const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountText || !databaseURL) {
        throw new Error("Firebase secrets are missing.");
    }

    const serviceAccount = JSON.parse(serviceAccountText);

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: databaseURL
        });
    }

    try {
        const snapshot = await admin.database()
            .ref("settings")
            .once("value");

        const settings = snapshot.val() || {};
        const parserKey = settings.selected_parser || "parse1";
        const parser = settings.parse && settings.parse[parserKey];

        if (!parser) {
            throw new Error(
                "Parser configuration not found: " + parserKey
            );
        }

        const apiParser = String(parser.api_parser || "")
            .trim()
            .toLowerCase();

        let script;

        if (
            apiParser === "365" ||
            apiParser === "365scores"
        ) {
            script = "apis/365scores.js";
        } else if (
            apiParser === "apifootball" ||
            apiParser === "api-football" ||
            apiParser === "football"
        ) {
            script = "apis/api-football.js";
        } else {
            throw new Error("Unsupported API: " + apiParser);
        }

        console.log("Selected parser:", parserKey);
        console.log("Selected API:", apiParser);
        console.log("Running:", script);

        await new Promise(function(resolve, reject) {
            const child = spawn(
                process.execPath,
                [path.join(__dirname, script)],
                {
                    stdio: "inherit",
                    env: process.env
                }
            );

            child.on("error", function(error) {
                reject(error);
            });

            child.on("close", function(code) {
                if (code === 0) {
                    resolve();
                } else {
                    reject(
                        new Error(
                            "API script failed with exit code " + code
                        )
                    );
                }
            });
        });

        console.log("SportsHub sync completed successfully.");

    } finally {
        if (admin.apps.length) {
            await admin.app().delete();
        }
    }
}

main().catch(function(error) {
    console.error("SportsHub sync failed:", error);
    process.exitCode = 1;
});

"use strict";

const admin = require("firebase-admin");
const path = require("path");

const TIME_ZONE = "Asia/Kolkata";
const DEFAULT_PROVIDER = "365scores";

function initializeFirebase() {
    if (admin.apps.length) return;

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountJson || !databaseURL) {
        throw new Error("Firebase secrets are missing");
    }

    admin.initializeApp({
        credential: admin.credential.cert(
            JSON.parse(serviceAccountJson)
        ),
        databaseURL: databaseURL
    });
}

function getProviderName(settings) {
    const parserName = settings.selected_parser;
    const parser = settings.parse &&
        settings.parse[parserName];

    const configuredName =
        process.env.API_PROVIDER ||
        (parser && parser.api_parser) ||
        DEFAULT_PROVIDER;

    const name = String(configuredName)
        .toLowerCase()
        .trim();

    if (name === "365" || name === "365scores") {
        return "365scores";
    }

    if (
        name === "api_parser" ||
        name === "api-football" ||
        name === "apifootball"
    ) {
        return "api-football";
    }

    throw new Error("Unsupported API provider: " + name);
}

function getDate(offset) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    return values.year + "-" +
        values.month + "-" + values.day;
}

function getOldMatchMap(root) {
    const result = {};

    ["matches", "availableMatches"].forEach(function (node) {
        const records = root[node] || {};

        Object.keys(records).forEach(function (key) {
            const match = records[key];

            if (match && typeof match === "object") {
                const id = match.gameId != null
                    ? String(match.gameId)
                    : key;

                if (!result[id]) {
                    result[id] = {};
                }

                Object.keys(match).forEach(function (field) {
                    if (
                        result[id][field] == null ||
                        result[id][field] === ""
                    ) {
                        result[id][field] = match[field];
                    }
                });
            }
        });
    });

    return result;
}

function getSelectedSports(settings) {
    const configured = settings.selected_sports;
    const ids = [];

    if (Array.isArray(configured)) {
        const containsBoolean = configured.some(function (value) {
            return typeof value === "boolean";
        });

        if (containsBoolean) {
            configured.forEach(function (value, index) {
                if (value === true) {
                    ids.push(index);
                }
            });
        } else {
            configured.forEach(function (value) {
                const id = Number(value);

                if (
                    Number.isFinite(id) &&
                    id > 0 &&
                    ids.indexOf(id) === -1
                ) {
                    ids.push(id);
                }
            });
        }
    }

    if (!ids.length && settings.selected_sport != null) {
        const fallback = Number(settings.selected_sport);

        if (Number.isFinite(fallback) && fallback > 0) {
            ids.push(fallback);
        }
    }

    return ids.length ? ids : [1];
}

function normalizeCompetitionId(match) {
    if (match.competitionId != null) {
        return String(match.competitionId);
    }

    if (match.leagueId != null) {
        return String(match.leagueId);
    }

    return "0";
}

async function main() {
    initializeFirebase();

    const db = admin.database();
    const rootRef = db.ref("/");
    const snapshot = await rootRef.once("value");
    const root = snapshot.val() || {};

    const settings = root.settings || {};
    const providerName = getProviderName(settings);

    const provider = require(
        path.join(__dirname, "apis", providerName + ".js")
    );

    const selectedParser = settings.selected_parser;
    const parserSettings =
        settings.parse && settings.parse[selectedParser]
            ? settings.parse[selectedParser]
            : {};

    const oldProvider = settings.last_synced_api_provider;
    const providerChanged =
        oldProvider != null &&
        oldProvider !== providerName;

    let fetched = [];

    const dates = [-1, 0, 1].map(function (offset) {
        return getDate(offset);
    });

    for (const date of dates) {
        try {
            let results;

            if (providerName === "365scores") {
                const sportIds = getSelectedSports(settings);

                results = await provider.fetchMatches({
                    date: date,
                    settings: settings,
                    parserSettings: parserSettings,
                    sportIds: sportIds
                });
            } else {
                results = await provider.fetchMatches({
                    date: date,
                    settings: settings,
                    parserSettings: parserSettings
                });
            }

            if (Array.isArray(results)) {
                fetched = fetched.concat(results);
                console.log(
                    "Fetched " + results.length +
                    " matches for " + date
                );
            }
        } catch (error) {
            console.error(
                "Date fetch failed: " + date,
                error.message
            );
        }
    }

    const unique = {};

    fetched.forEach(function (match) {
        if (!match || match.gameId == null) return;

        const id = String(match.gameId);

        if (!unique[id]) {
            unique[id] = match;
        } else {
            unique[id] = Object.assign({}, unique[id], match);
        }
    });

    const newMatches = Object.keys(unique).map(function (id) {
        return unique[id];
    });

    if (!newMatches.length) {
        throw new Error(
            "No matches fetched. Existing Firebase data was not changed."
        );
    }

    const oldMatchMap = getOldMatchMap(root);

    const competitions = Object.assign(
        {},
        root.competitions || {}
    );

    const selection = Object.assign(
        {},
        root.competition_selection || {}
    );

    const availableMatches = {};

    newMatches.forEach(function (match) {
        const id = String(match.gameId);
        const old = oldMatchMap[id] || {};

        if (!providerChanged && old.streamUrl && !match.streamUrl) {
            match.streamUrl = old.streamUrl;
        }

        const competitionId = normalizeCompetitionId(match);

        if (competitionId !== "0") {
            if (!competitions[competitionId]) {
                competitions[competitionId] = {
                    id: Number(competitionId),
                    name: match.competitionName || "Unknown Competition",
                    selected: selection[competitionId] === true,
                    sportId: match.sportId == null
                        ? 1
                        : Number(match.sportId)
                };
            } else {
                if (
                    match.competitionName &&
                    (
                        !competitions[competitionId].name ||
                        competitions[competitionId].name === "Unknown Competition"
                    )
                ) {
                    competitions[competitionId].name =
                        match.competitionName;
                }

                if (competitions[competitionId].sportId == null) {
                    competitions[competitionId].sportId =
                        match.sportId == null ? 1 : Number(match.sportId);
                }
            }

            if (selection[competitionId] == null) {
                selection[competitionId] =
                    competitions[competitionId].selected === true;
            }

            competitions[competitionId].selected =
                selection[competitionId] === true;
        }

        availableMatches[id] = Object.assign({}, match);
    });

    const selectedMatches = {};

    Object.keys(availableMatches).forEach(function (id) {
        const match = availableMatches[id];
        const competitionId = normalizeCompetitionId(match);

        if (
            competitionId === "0" ||
            selection[competitionId] === true
        ) {
            selectedMatches[id] = match;
        }
    });

    const updatedSettings = Object.assign({}, settings, {
        last_synced_api_provider: providerName,
        lastSuccessfulSync: Date.now(),
        lastSyncDate: new Date().toISOString()
    });

    const updates = {
        availableMatches: availableMatches,
        matches: selectedMatches,
        competitions: competitions,
        competition_selection: selection,
        settings: updatedSettings
    };

    if (providerChanged) {
        updates.selectedFixtures = null;
        console.log(
            "Provider changed from " + oldProvider +
            " to " + providerName
        );
    }

    await rootRef.update(updates);

    console.log("Provider: " + providerName);
    console.log("Unique matches: " + newMatches.length);
    console.log("Selected matches: " + Object.keys(selectedMatches).length);
    console.log("Competitions preserved: " + Object.keys(competitions).length);
    console.log("Firebase sync completed successfully.");
}

main().catch(function (error) {
    console.error("SYNC FAILED:", error.message);
    process.exitCode = 1;
});

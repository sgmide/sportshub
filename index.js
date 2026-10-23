
"use strict";

const admin = require("firebase-admin");
const path = require("path");

const TIME_ZONE = "Asia/Kolkata";
const DEFAULT_PROVIDER = "365scores";
const FETCH_DATES = [-1, 0, 1];

function initializeFirebase() {
    if (admin.apps.length) return;

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountJson || !databaseURL) {
        throw new Error("Firebase secrets are missing.");
    }

    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
        databaseURL: databaseURL
    });
}

function normalizeProviderName(value) {
    const name = String(value || "").trim().toLowerCase();

    if (name === "365" || name === "365scores") {
        return "365scores";
    }

    if (
        name === "api_parser" ||
        name === "apifootball" ||
        name === "api-football" ||
        name === "football"
    ) {
        return "api-football";
    }

    throw new Error("Unsupported API provider: " + name);
}

function getProviderName(settings) {
    const parserName = settings.selected_parser;
    const parser = settings.parse && settings.parse[parserName];

    const configuredName =
        process.env.API_PROVIDER ||
        (parser && parser.api_parser) ||
        DEFAULT_PROVIDER;

    return normalizeProviderName(configuredName);
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

    return values.year + "-" + values.month + "-" + values.day;
}

/*
 * Read old match data only.
 * availableMatches is not used.
 */
function getOldMatchMap(root) {
    const result = {};
    const records = root.matches || {};

    Object.keys(records).forEach(function (key) {
        const match = records[key];

        if (!match || typeof match !== "object") {
            return;
        }

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

function normalizeGameId(match) {
    if (!match || typeof match !== "object") {
        return null;
    }

    if (match.gameId != null && String(match.gameId) !== "") {
        return String(match.gameId);
    }

    if (
        match.apiFixtureId != null &&
        String(match.apiFixtureId) !== ""
    ) {
        return String(match.apiFixtureId);
    }

    if (match.id != null && String(match.id) !== "") {
        return String(match.id);
    }

    return null;
}

function normalizeMatch(match) {
    const id = normalizeGameId(match);

    if (!id) {
        return null;
    }

    const normalized = Object.assign({}, match);
    normalized.gameId = id;

    return normalized;
}

function mergeMatches(matches) {
    const unique = {};

    matches.forEach(function (item) {
        const match = normalizeMatch(item);

        if (!match) {
            return;
        }

        const id = match.gameId;

        if (!unique[id]) {
            unique[id] = match;
        } else {
            unique[id] = Object.assign({}, unique[id], match);
        }
    });

    return Object.keys(unique).map(function (id) {
        return unique[id];
    });
}

async function fetchProviderMatches(
    provider,
    providerName,
    settings,
    parserSettings
) {
    const dates = FETCH_DATES.map(function (offset) {
        return getDate(offset);
    });

    const fetched = [];

    for (const date of dates) {
        let results;

        try {
            const options = {
                date: date,
                settings: settings,
                parserSettings: parserSettings
            };

            if (providerName === "365scores") {
                options.sportIds = getSelectedSports(settings);
            }

            results = await provider.fetchMatches(options);
        } catch (error) {
            throw new Error(
                "API request failed for " +
                date +
                ": " +
                error.message
            );
        }

        if (!Array.isArray(results)) {
            throw new Error(
                "Invalid API response for " +
                date +
                ". Expected an array."
            );
        }

        console.log(
            "Fetched " + results.length + " matches for " + date
        );

        fetched.push.apply(fetched, results);
    }

    return mergeMatches(fetched);
}

async function main() {
    initializeFirebase();

    const db = admin.database();
    const rootRef = db.ref("/");

    const snapshot = await rootRef.once("value");
    const root = snapshot.val() || {};

    const settings = root.settings || {};
    const providerName = getProviderName(settings);

    const selectedParser = settings.selected_parser;

    const parserSettings =
        settings.parse && settings.parse[selectedParser]
            ? settings.parse[selectedParser]
            : {};

    const previousProviderValue =
        settings.last_synced_api_provider;

    const oldProvider = previousProviderValue
        ? normalizeProviderName(previousProviderValue)
        : null;

    const providerChanged = oldProvider !== null &&
        oldProvider !== providerName;

    console.log("Current provider:", providerName);
    console.log("Previous provider:", oldProvider || "not recorded");
    console.log("Provider changed:", providerChanged);

    const provider = require(
        path.join(__dirname, "apis", providerName + ".js")
    );

    if (!provider || typeof provider.fetchMatches !== "function") {
        throw new Error(
            "Provider must export fetchMatches(options): " +
            providerName
        );
    }

    const newMatches = await fetchProviderMatches(
        provider,
        providerName,
        settings,
        parserSettings
    );

    /*
     * Protect existing Firebase data if the API unexpectedly
     * returns no valid matches.
     */
    if (!newMatches.length) {
        throw new Error(
            "No valid matches fetched. Existing Firebase data was not changed."
        );
    }

    const oldMatchMap = getOldMatchMap(root);

    /*
     * Preserve existing competitions and selections unless
     * the API provider has changed.
     */
    const competitions = providerChanged
        ? {}
        : Object.assign({}, root.competitions || {});

    const selection = providerChanged
        ? {}
        : Object.assign({}, root.competition_selection || {});

    /*
     * This is the only match collection written to Firebase.
     * There is no availableMatches collection.
     */
    const selectedMatches = {};

    newMatches.forEach(function (item) {
        const match = Object.assign({}, item);
        const id = String(match.gameId);

        const old = oldMatchMap[id] || {};

        // Preserve the admin's stream URL when the API
        // response does not contain one.
        if (!providerChanged && old.streamUrl && !match.streamUrl) {
            match.streamUrl = old.streamUrl;
        }

        const competitionId = normalizeCompetitionId(match);

        /*
         * Register competitions so the Admin app can display
         * them, even when they are not currently selected.
         */
        if (competitionId !== "0") {
            if (!competitions[competitionId]) {
                competitions[competitionId] = {
                    id: Number(competitionId),
                    name: match.competitionName ||
                        match.league ||
                        "Unknown Competition",
                    selected: false,
                    sportId: match.sportId == null
                        ? 1
                        : Number(match.sportId)
                };
            } else {
                if (
                    match.competitionName &&
                    (
                        !competitions[competitionId].name ||
                        competitions[competitionId].name ===
                            "Unknown Competition"
                    )
                ) {
                    competitions[competitionId].name =
                        match.competitionName;
                }

                if (
                    !competitions[competitionId].name &&
                    match.league
                ) {
                    competitions[competitionId].name = match.league;
                }

                if (competitions[competitionId].sportId == null) {
                    competitions[competitionId].sportId =
                        match.sportId == null
                            ? 1
                            : Number(match.sportId);
                }
            }

            /*
             * Preserve the existing competition_selection value.
             * New competitions default to false.
             */
            if (selection[competitionId] == null) {
                selection[competitionId] =
                    competitions[competitionId].selected === true;
            }

            competitions[competitionId].selected =
                selection[competitionId] === true;

            /*
             * Add a match only when its competition is selected.
             * Competitions without a valid ID are excluded.
             */
            if (selection[competitionId] === true) {
                selectedMatches[id] = match;
            }
        }
    });

    const updatedSettings = Object.assign({}, settings, {
        last_synced_api_provider: providerName,
        lastSuccessfulSync: Date.now(),
        lastSyncDate: new Date().toISOString()
    });

    const updates = {
        matches: selectedMatches,
        competitions: competitions,
        competition_selection: selection,
        settings: updatedSettings,

        // Remove the old node if it exists.
        availableMatches: null
    };

    if (providerChanged) {
        console.log(
            "Provider changed from " +
            oldProvider +
            " to " +
            providerName
        );

        console.log(
            "Old matches, competitions and competition selections " +
            "will be replaced."
        );
    }

    await rootRef.update(updates);

    console.log("Provider:", providerName);
    console.log("Provider changed:", providerChanged);
    console.log("Fetched unique matches:", newMatches.length);
    console.log(
        "Selected matches saved:",
        Object.keys(selectedMatches).length
    );
    console.log("Competitions:", Object.keys(competitions).length);
    console.log(
        "Competition selections:",
        Object.keys(selection).length
    );

    console.log("Firebase sync completed successfully.");
}

main()
    .catch(function (error) {
        console.error("SYNC FAILED:", error.message);
        process.exitCode = 1;
    })
    .finally(async function () {
        if (admin.apps.length) {
            await Promise.all(
                admin.apps.map(function (app) {
                    return app.delete();
                })
            );
        }
    });

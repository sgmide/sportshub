"use strict";

const admin = require("firebase-admin");
const path = require("path");

const TIME_ZONE = "Asia/Kolkata";
const DEFAULT_PROVIDER = "365scores";
const FETCH_DATES = [-1, 0, 1];

function initializeFirebase() {
    if (admin.apps.length) return;

    const serviceAccountJson =
        process.env.FIREBASE_SERVICE_ACCOUNT;

    const databaseURL =
        process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountJson || !databaseURL) {
        throw new Error("Firebase secrets are missing.");
    }

    admin.initializeApp({
        credential: admin.credential.cert(
            JSON.parse(serviceAccountJson)
        ),
        databaseURL: databaseURL
    });
}

function normalizeProviderName(value) {
    const name = String(value || "").trim().toLowerCase();

    if (name === "365" || name === "365scores") {
        return "365scores";
    }

    if (name === "king") {
        return "king";
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

/*
 * Firebase Settings-ലെ selected_parser-ന് മുൻഗണന.
 * GitHub Actions-ലെ API_PROVIDER മാറ്റാതെ വെച്ചാൽ
 * provider മാറാത്ത പ്രശ്നം ഒഴിവാക്കാൻ അത് ഉപയോഗിക്കുന്നില്ല.
 */
function getProviderName(settings) {
    const parserName = settings.selected_parser;
    const parser =
        settings.parse && settings.parse[parserName];

    const configuredName =
        parser && parser.api_parser
            ? parser.api_parser
            : DEFAULT_PROVIDER;

    return normalizeProviderName(configuredName);
}

function getDate(offset) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    const date = new Date(Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day) + offset
    ));

    return date.getUTCFullYear() + "-" +
        String(date.getUTCMonth() + 1).padStart(2, "0") + "-" +
        String(date.getUTCDate()).padStart(2, "0");
}

function normalizeGameId(match) {
    if (!match || typeof match !== "object") {
        return null;
    }

    const id =
        match.gameId != null ? match.gameId :
        match.apiFixtureId != null ? match.apiFixtureId :
        match.id != null ? match.id : null;

    if (id == null || String(id).trim() === "") {
        return null;
    }

    return String(id);
}

function normalizeMatch(match) {
    const id = normalizeGameId(match);

    if (!id) return null;

    const normalized = Object.assign({}, match);
    const numericId = Number(id);

    normalized.gameId = Number.isFinite(numericId)
        ? numericId
        : id;

    return normalized;
}

function isEmpty(value) {
    return value == null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);
}

function mergeMatches(matches) {
    const unique = Object.create(null);

    matches.forEach(function (item) {
        const match = normalizeMatch(item);

        if (!match) return;

        const id = String(match.gameId);

        if (!unique[id]) {
            unique[id] = match;
            return;
        }

        const merged = Object.assign({}, unique[id]);

        Object.keys(match).forEach(function (field) {
            if (!isEmpty(match[field])) {
                merged[field] = match[field];
            }
        });

        unique[id] = merged;
    });

    return Object.keys(unique).map(function (id) {
        return unique[id];
    });
}

function getSelectedSports(settings) {
    const configured = settings.selected_sports;
    const ids = [];

    if (
        configured &&
        typeof configured === "object" &&
        !Array.isArray(configured)
    ) {
        Object.keys(configured).forEach(function (key) {
            const id = Number(key);

            if (
                configured[key] === true &&
                Number.isFinite(id) &&
                id > 0 &&
                ids.indexOf(id) === -1
            ) {
                ids.push(id);
            }
        });
    }

    if (Array.isArray(configured)) {
        configured.forEach(function (value, index) {
            if (typeof value === "boolean") {
                if (
                    value &&
                    index > 0 &&
                    ids.indexOf(index) === -1
                ) {
                    ids.push(index);
                }
            } else {
                const id = Number(value);

                if (
                    Number.isFinite(id) &&
                    id > 0 &&
                    ids.indexOf(id) === -1
                ) {
                    ids.push(id);
                }
            }
        });
    }

    if (ids.length === 0) {
        throw new Error(
            "No sports selected in settings/selected_sports."
        );
    }

    return ids;
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

    if (providerName === "365scores") {
        const sportIds = getSelectedSports(settings);

        console.log(
            "Selected sports:",
            sportIds.join(", ")
        );
    }

    console.log("Dates to fetch:", dates.join(", "));

    for (const date of dates) {
        const options = {
            date: date,
            settings: settings,
            parserSettings: parserSettings
        };

        if (providerName === "365scores") {
            options.sportIds = getSelectedSports(settings);
        }

        let results;

        try {
            results = await provider.fetchMatches(options);
        } catch (error) {
            throw new Error(
                "API request failed for " + date + ": " +
                error.message
            );
        }

        if (!Array.isArray(results)) {
            throw new Error(
                "Invalid API response for " + date +
                ". Expected an array."
            );
        }

        console.log(
            "Fetched " + results.length +
            " matches for " + date
        );

        fetched.push.apply(fetched, results);
    }

    return mergeMatches(fetched);
}

function getOldMatchMap(root) {
    const result = {};
    const records = root.matches || {};

    Object.keys(records).forEach(function (key) {
        const match = records[key];

        if (!match || typeof match !== "object") return;

        const id = normalizeGameId(match) || key;

        if (!result[id]) result[id] = {};

        Object.keys(match).forEach(function (field) {
            if (
                isEmpty(result[id][field]) &&
                !isEmpty(match[field])
            ) {
                result[id][field] = match[field];
            }
        });
    });

    return result;
}

function preserveOldMatchData(match, old, providerChanged) {
    if (providerChanged || !old) return match;

    [
        "homeLogo",
        "awayLogo",
        "streamUrl",
        "stadium",
        "goalEvents"
    ].forEach(function (field) {
        if (
            isEmpty(match[field]) &&
            !isEmpty(old[field])
        ) {
            match[field] = old[field];
        }
    });

    return match;
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

function getPreviousProvider(settings) {
    const value = settings.last_synced_api_provider;

    if (!value) return null;

    try {
        return normalizeProviderName(value);
    } catch (error) {
        console.log(
            "Unrecognized previous provider:",
            value
        );

        return null;
    }
}

async function main() {
    initializeFirebase();

    const db = admin.database();
    const rootRef = db.ref("/");

    const snapshot = await rootRef.once("value");
    const root = snapshot.val() || {};
    const settings = root.settings || {};

    const selectedParser = settings.selected_parser;

    const parserSettings =
        settings.parse &&
        settings.parse[selectedParser]
            ? settings.parse[selectedParser]
            : {};

    const providerName = getProviderName(settings);
    const oldProvider = getPreviousProvider(settings);

    const hasExistingData =
        Object.keys(root.matches || {}).length > 0 ||
        Object.keys(root.competitions || {}).length > 0 ||
        Object.keys(root.competition_selection || {}).length > 0;

    const providerChanged = oldProvider
        ? oldProvider !== providerName
        : hasExistingData;

    console.log("Selected parser:", selectedParser);
    console.log("Current provider:", providerName);
    console.log(
        "Previous provider:",
        oldProvider || "not recorded"
    );
    console.log("Provider changed:", providerChanged);

    const provider = require(
        path.join(__dirname, "apis", providerName + ".js")
    );

    if (
        !provider ||
        typeof provider.fetchMatches !== "function"
    ) {
        throw new Error(
            "Provider must export fetchMatches(options): " +
            providerName
        );
    }

    /*
     * API fetch വിജയിച്ചശേഷം മാത്രമേ Firebase data മാറ്റൂ.
     */
    const newMatches = await fetchProviderMatches(
        provider,
        providerName,
        settings,
        parserSettings
    );

    if (newMatches.length === 0) {
        throw new Error(
            "No valid matches fetched. " +
            "Existing Firebase data was not changed."
        );
    }

    /*
     * Provider മാറിയാൽ പഴയ competitions, selections,
     * matches എന്നിവ പുനരുപയോഗിക്കരുത്.
     */
    const oldMatchMap = providerChanged
        ? {}
        : getOldMatchMap(root);

    const competitions = providerChanged
        ? {}
        : Object.assign({}, root.competitions || {});

    const selection = providerChanged
        ? {}
        : Object.assign({}, root.competition_selection || {});

    const selectedMatches = {};

    newMatches.forEach(function (item) {
        const match = Object.assign({}, item);
        const id = String(match.gameId);

        preserveOldMatchData(
            match,
            oldMatchMap[id] || null,
            providerChanged
        );

        const competitionId = normalizeCompetitionId(match);

        if (competitionId === "0") {
            console.log(
                "Skipping match without competition ID:",
                id
            );

            return;
        }

        if (!competitions[competitionId]) {
            competitions[competitionId] = {
                id: isNaN(Number(competitionId))
                    ? competitionId
                    : Number(competitionId),

                name:
                    match.competitionName ||
                    match.league ||
                    "Unknown Competition",

                selected: false,
                sportId: Number(match.sportId || 1)
            };
        } else {
            const competition = competitions[competitionId];

            if (
                match.competitionName &&
                (
                    !competition.name ||
                    competition.name === "Unknown Competition"
                )
            ) {
                competition.name = match.competitionName;
            }

            if (!competition.name && match.league) {
                competition.name = match.league;
            }

            if (competition.sportId == null) {
                competition.sportId =
                    Number(match.sportId || 1);
            }
        }

        if (selection[competitionId] == null) {
            selection[competitionId] =
                competitions[competitionId].selected === true;
        }

        competitions[competitionId].selected =
            selection[competitionId] === true;

        if (selection[competitionId] === true) {
            selectedMatches[id] = match;
        }
    });

    const updatedSettings = Object.assign({}, settings, {
        last_synced_api_provider: providerName,
        lastSuccessfulSync: Date.now(),
        lastSyncDate: new Date().toISOString()
    });

    /*
     * API മാറിയാൽ പുതിയ competition list മാത്രം save ചെയ്യുക.
     * പുതിയ competitions എല്ലാം ആദ്യം unselected ആയിരിക്കും.
     */
    if (providerChanged) {
        await rootRef.update({
            matches: null,
            competitions: competitions,
            competition_selection: selection,
            availableMatches: null,
            settings: updatedSettings
        });

        console.log("--------------------------------");
        console.log("PROVIDER CHANGE COMPLETED");
        console.log("Provider:", providerName);
        console.log(
            "New competitions:",
            Object.keys(competitions).length
        );
        console.log("Old matches cleared.");
        console.log("Old selections cleared.");
        console.log(
            "Select competitions in Admin, then sync again."
        );
        console.log("--------------------------------");

        return;
    }

    /*
     * അതേ API ആണെങ്കിൽ selection ഇല്ലാത്തതിനാൽ മാത്രം
     * നിലവിലുള്ള matches delete ചെയ്യരുത്.
     */
    if (Object.keys(selectedMatches).length === 0) {
        throw new Error(
            "No selected-competition matches were produced. " +
            "Existing Firebase data was not changed. " +
            "Check competition_selection IDs."
        );
    }

    await rootRef.update({
        matches: selectedMatches,
        competitions: competitions,
        competition_selection: selection,
        availableMatches: null,
        settings: updatedSettings
    });

    console.log("--------------------------------");
    console.log("Firebase sync completed successfully.");
    console.log("Provider:", providerName);
    console.log("Fetched matches:", newMatches.length);
    console.log(
        "Saved selected matches:",
        Object.keys(selectedMatches).length
    );
    console.log(
        "Competitions:",
        Object.keys(competitions).length
    );
    console.log("--------------------------------");
}

main()
    .catch(function (error) {
        console.error(
            "SYNC FAILED:",
            error.stack || error.message
        );

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

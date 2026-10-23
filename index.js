
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
        throw new Error(
            "Firebase secrets are missing."
        );
    }

    admin.initializeApp({
        credential: admin.credential.cert(
            JSON.parse(serviceAccountJson)
        ),
        databaseURL: databaseURL
    });
}

function normalizeProviderName(value) {
    const name = String(value || "")
        .trim()
        .toLowerCase();

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

    throw new Error(
        "Unsupported API provider: " + name
    );
}

function getProviderName(settings) {
    const parserName = settings.selected_parser;

    const parser =
        settings.parse &&
        settings.parse[parserName];

    const configuredName =
        process.env.API_PROVIDER ||
        (parser && parser.api_parser) ||
        DEFAULT_PROVIDER;

    return normalizeProviderName(configuredName);
}

/*
 * Return date in YYYY-MM-DD format using
 * Asia/Kolkata as the local timezone.
 */
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

/*
 * Read existing matches.
 * Do not use availableMatches as a data source.
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
            const oldValue = result[id][field];
            const newValue = match[field];

            if (
                oldValue == null ||
                oldValue === "" ||
                (
                    Array.isArray(oldValue) &&
                    oldValue.length === 0
                )
            ) {
                result[id][field] = newValue;
            }
        });
    });

    return result;
}

/*
 * Admin app format:
 *
 * settings/selected_sports/{sportId}: true
 *
 * Only fetch sports selected by the Admin app.
 */
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

    /*
     * Support older array format.
     */
    if (Array.isArray(configured)) {
        configured.forEach(function (value, index) {
            if (typeof value === "boolean") {
                if (value === true && index > 0) {
                    if (ids.indexOf(index) === -1) {
                        ids.push(index);
                    }
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
            "No sports selected. Enable sports in " +
            "settings/selected_sports in Firebase."
        );
    }

    return ids;
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

    if (
        match.gameId != null &&
        String(match.gameId) !== ""
    ) {
        return String(match.gameId);
    }

    if (
        match.apiFixtureId != null &&
        String(match.apiFixtureId) !== ""
    ) {
        return String(match.apiFixtureId);
    }

    if (
        match.id != null &&
        String(match.id) !== ""
    ) {
        return String(match.id);
    }

    return null;
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

/*
 * Merge duplicate API results.
 * Empty fields should not overwrite useful values.
 */
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

        const previous = unique[id];
        const merged = Object.assign({}, previous);

        Object.keys(match).forEach(function (field) {
            const value = match[field];

            const isEmpty =
                value == null ||
                value === "" ||
                (
                    Array.isArray(value) &&
                    value.length === 0
                );

            if (!isEmpty) {
                merged[field] = value;
            }
        });

        unique[id] = merged;
    });

    return Object.keys(unique).map(function (id) {
        return unique[id];
    });
}

/*
 * Fetch yesterday, today and tomorrow.
 */
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

    let sportIds = [];

    if (providerName === "365scores") {
        sportIds = getSelectedSports(settings);

        console.log(
            "Selected sports:",
            sportIds.join(", ")
        );
    }

    console.log(
        "Dates to fetch:",
        dates.join(", ")
    );

    for (const date of dates) {
        let results;

        try {
            const options = {
                date: date,
                settings: settings,
                parserSettings: parserSettings
            };

            if (providerName === "365scores") {
                options.sportIds = sportIds;
            }

            results = await provider.fetchMatches(options);

        } catch (error) {
            throw new Error(
                "API request failed for " +
                date + ": " + error.message
            );
        }

        if (!Array.isArray(results)) {
            throw new Error(
                "Invalid API response for " +
                date + ". Expected an array."
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

/*
 * Keep old match information if the API omits it.
 */
function preserveOldMatchData(
    match,
    old,
    providerChanged
) {
    if (providerChanged || !old) {
        return match;
    }

    const fieldsToPreserve = [
        "homeLogo",
        "awayLogo",
        "streamUrl",
        "stadium",
        "goalEvents"
    ];

    fieldsToPreserve.forEach(function (field) {
        const current = match[field];
        const previous = old[field];

        const currentIsEmpty =
            current == null ||
            current === "" ||
            (
                Array.isArray(current) &&
                current.length === 0
            );

        const previousIsAvailable =
            previous != null &&
            previous !== "" &&
            !(
                Array.isArray(previous) &&
                previous.length === 0
            );

        if (currentIsEmpty && previousIsAvailable) {
            match[field] = previous;
        }
    });

    return match;
}

/*
 * Main synchronization.
 */
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
        settings.parse &&
        settings.parse[selectedParser]
            ? settings.parse[selectedParser]
            : {};

    const previousProviderValue =
        settings.last_synced_api_provider;

    const oldProvider = previousProviderValue
        ? normalizeProviderName(previousProviderValue)
        : null;

    const providerChanged =
        oldProvider !== null &&
        oldProvider !== providerName;

    console.log(
        "Current provider:",
        providerName
    );

    console.log(
        "Previous provider:",
        oldProvider || "not recorded"
    );

    console.log(
        "Provider changed:",
        providerChanged
    );

    const provider = require(
        path.join(
            __dirname,
            "apis",
            providerName + ".js"
        )
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

    const newMatches = await fetchProviderMatches(
        provider,
        providerName,
        settings,
        parserSettings
    );

    /*
     * Never replace Firebase data when all requests
     * return no valid matches.
     */
    if (newMatches.length === 0) {
        throw new Error(
            "No valid matches fetched. " +
            "Existing Firebase data was not changed."
        );
    }

    const oldMatchMap = getOldMatchMap(root);

    /*
     * Keep existing competition records and selection
     * unless the provider has changed.
     */
    const competitions = providerChanged
        ? {}
        : Object.assign(
            {},
            root.competitions || {}
        );

    const selection = providerChanged
        ? {}
        : Object.assign(
            {},
            root.competition_selection || {}
        );

    const selectedMatches = {};

    newMatches.forEach(function (item) {
        const match = Object.assign({}, item);
        const id = String(match.gameId);

        const old = oldMatchMap[id] || {};

        preserveOldMatchData(
            match,
            old,
            providerChanged
        );

        const competitionId =
            normalizeCompetitionId(match);

        if (competitionId === "0") {
            console.log(
                "Skipping match without competition ID:",
                id
            );

            return;
        }

        /*
         * Create or update competition records.
         */
        if (!competitions[competitionId]) {
            competitions[competitionId] = {
                id: Number(competitionId),
                name:
                    match.competitionName ||
                    match.league ||
                    "Unknown Competition",

                selected: false,

                sportId: match.sportId == null
                    ? 1
                    : Number(match.sportId)
            };
        } else {
            const competition =
                competitions[competitionId];

            if (
                match.competitionName &&
                (
                    !competition.name ||
                    competition.name === "Unknown Competition"
                )
            ) {
                competition.name =
                    match.competitionName;
            }

            if (!competition.name && match.league) {
                competition.name = match.league;
            }

            if (competition.sportId == null) {
                competition.sportId =
                    match.sportId == null
                        ? 1
                        : Number(match.sportId);
            }
        }

        /*
         * Read selection from the existing competition
         * record when the separate selection map has
         * no value. This supports the Admin app.
         */
        if (selection[competitionId] == null) {
            selection[competitionId] =
                competitions[competitionId].selected === true;
        }

        /*
         * Keep both selection representations aligned.
         */
        competitions[competitionId].selected =
            selection[competitionId] === true;

        /*
         * Save only matches belonging to selected
         * competitions.
         */
        if (selection[competitionId] === true) {
            selectedMatches[id] = match;
        }
    });

    /*
     * Do not erase existing matches if every fetched
     * match was invalid or had no competition ID.
     */
    if (Object.keys(selectedMatches).length === 0) {
        throw new Error(
            "No selected-competition matches were produced. " +
            "Existing Firebase data was not changed. " +
            "Check competition selections and API response."
        );
    }

    const updatedSettings = Object.assign(
        {},
        settings,
        {
            last_synced_api_provider: providerName,
            lastSuccessfulSync: Date.now(),
            lastSyncDate: new Date().toISOString()
        }
    );

    const updates = {
        matches: selectedMatches,
        competitions: competitions,
        competition_selection: selection,
        settings: updatedSettings,
        availableMatches: null
    };

    if (providerChanged) {
        console.log(
            "Provider changed. Previous provider's " +
            "matches and competition selections " +
            "will be replaced."
        );
    }

    await rootRef.update(updates);

    console.log("--------------------------------");
    console.log("Firebase sync completed successfully.");
    console.log("Provider:", providerName);
    console.log("Fetched unique matches:", newMatches.length);
    console.log(
        "Selected matches saved:",
        Object.keys(selectedMatches).length
    );
    console.log(
        "Competitions:",
        Object.keys(competitions).length
    );
    console.log(
        "Competition selections:",
        Object.keys(selection).length
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

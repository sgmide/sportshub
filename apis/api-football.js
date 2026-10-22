"use strict";

const admin = require("firebase-admin");
const axios = require("axios");

// ============================================
// CONFIGURATION
// ============================================

const DEFAULT_API_URL =
    "https://v3.football.api-sports.io/fixtures";

const TIME_ZONE = "Asia/Kolkata";
const REQUEST_TIMEOUT = 30000;
const REQUEST_DELAY = 700;

const API_KEY = process.env.API_FOOTBALL_KEY;
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const SERVICE_ACCOUNT_JSON =
    process.env.FIREBASE_SERVICE_ACCOUNT;

// Firebase paths
const SETTINGS_PATH = "settings";
const COMPETITIONS_PATH = "competitions";
const SELECTION_PATH = "competition_selection";
const MATCHES_PATH = "matches";
const SYNC_SETTINGS_PATH = "syncSettings";

// ============================================
// FIREBASE INITIALIZATION
// ============================================

function initializeFirebase() {
    if (admin.apps.length > 0) {
        return;
    }

    if (!DATABASE_URL) {
        throw new Error(
            "FIREBASE_DATABASE_URL secret is missing."
        );
    }

    if (!SERVICE_ACCOUNT_JSON) {
        throw new Error(
            "FIREBASE_SERVICE_ACCOUNT secret is missing."
        );
    }

    let serviceAccount;

    try {
        serviceAccount = JSON.parse(SERVICE_ACCOUNT_JSON);
    } catch (error) {
        throw new Error(
            "FIREBASE_SERVICE_ACCOUNT is not valid JSON."
        );
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: DATABASE_URL
    });
}

const sleep = function (milliseconds) {
    return new Promise(function (resolve) {
        setTimeout(resolve, milliseconds);
    });
};

// ============================================
// GENERAL HELPERS
// ============================================

function asObject(value) {
    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    ) {
        return value;
    }

    return {};
}

function toNumber(value, fallback) {
    const number = Number(value);

    if (Number.isFinite(number)) {
        return number;
    }

    return fallback;
}

function cleanText(value, fallback) {
    if (value === undefined || value === null) {
        return fallback || "";
    }

    return String(value);
}

function getDateOffset(offset) {
    const date = new Date();

    date.setUTCDate(date.getUTCDate() + offset);

    const year = date.getUTCFullYear();
    const month = String(
        date.getUTCMonth() + 1
    ).padStart(2, "0");

    const day = String(
        date.getUTCDate()
    ).padStart(2, "0");

    return year + "-" + month + "-" + day;
}

function getTimestamp(fixture) {
    const timestamp = toNumber(
        fixture &&
        fixture.fixture &&
        fixture.fixture.timestamp,
        0
    );

    if (timestamp > 0) {
        return timestamp * 1000;
    }

    const dateText =
        fixture &&
        fixture.fixture &&
        fixture.fixture.date;

    if (dateText) {
        const parsed = Date.parse(dateText);

        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return 0;
}

function normalizeId(value) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return "";
    }

    return String(value);
}

// ============================================
// PROVIDER HELPERS
// ============================================

function normalizeProvider(value) {
    const provider = cleanText(value, "")
        .toLowerCase()
        .trim();

    if (
        provider === "apifootball" ||
        provider === "api-football" ||
        provider === "api_football" ||
        provider === "api football"
    ) {
        return "apifootball";
    }

    if (
        provider === "365" ||
        provider === "365scores" ||
        provider === "365_scores"
    ) {
        return "365scores";
    }

    return provider;
}

function isApiFootballSelected(settings) {
    const root = asObject(settings);
    const selectedParser = cleanText(
        root.selected_parser,
        "parse1"
    );

    const parseSettings = asObject(root.parse);
    const parser = asObject(
        parseSettings[selectedParser]
    );

    const apiParser = normalizeProvider(
        parser.api_parser
    );

    return (
        apiParser === "apifootball" ||
        apiParser === "api-football" ||
        apiParser === "api_football"
    );
}

// ============================================
// COMPETITION SELECTION
// ============================================

function isCompetitionSelected(selectionValue) {
    // A missing selection is treated as not selected.
    // This controls display selection, NOT saving matches.

    if (
        selectionValue === true ||
        selectionValue === "true" ||
        selectionValue === 1 ||
        selectionValue === "1"
    ) {
        return true;
    }

    if (
        selectionValue === false ||
        selectionValue === "false" ||
        selectionValue === 0 ||
        selectionValue === "0" ||
        selectionValue === null ||
        selectionValue === undefined
    ) {
        return false;
    }

    if (typeof selectionValue === "object") {
        const value = asObject(selectionValue);

        if (value.selected !== undefined) {
            return (
                value.selected === true ||
                value.selected === "true" ||
                value.selected === 1 ||
                value.selected === "1"
            );
        }

        if (value.enabled !== undefined) {
            return (
                value.enabled === true ||
                value.enabled === "true" ||
                value.enabled === 1 ||
                value.enabled === "1"
            );
        }
    }

    return false;
}

function getSelectionValue(selectionData, competitionId) {
    const selections = asObject(selectionData);

    return selections[competitionId];
}

// ============================================
// STATUS HELPERS
// ============================================

function getShortStatus(fixture) {
    return cleanText(
        fixture &&
        fixture.fixture &&
        fixture.fixture.status &&
        fixture.fixture.status.short,
        "NS"
    ).toUpperCase();
}

function getElapsed(fixture) {
    const elapsed = fixture &&
        fixture.fixture &&
        fixture.fixture.status &&
        fixture.fixture.status.elapsed;

    if (elapsed === null || elapsed === undefined) {
        return 0;
    }

    return toNumber(elapsed, 0);
}

function getStatusText(fixture) {
    const shortStatus = getShortStatus(fixture);
    const elapsed = getElapsed(fixture);

    switch (shortStatus) {
        case "TBD":
            return "TBD";

        case "NS":
            return "UPCOMING";

        case "1H":
            return elapsed > 0
                ? elapsed + "'"
                : "1H";

        case "HT":
            return "HT";

        case "2H":
            return elapsed > 0
                ? elapsed + "'"
                : "2H";

        case "ET":
            return elapsed > 0
                ? elapsed + "'"
                : "ET";

        case "BT":
            return "BT";

        case "P":
            return "PEN";

        case "LIVE":
            return elapsed > 0
                ? elapsed + "'"
                : "LIVE";

        case "SUSP":
            return "SUSP";

        case "INT":
            return "INT";

        case "FT":
            return "FT";

        case "AET":
            return "AET";

        case "PEN":
            return "PEN";

        case "PST":
            return "PST";

        case "CANC":
            return "CANC";

        case "ABD":
            return "ABD";

        case "AWD":
            return "AWD";

        case "WO":
            return "WO";

        case "1P":
            return "1P";

        case "2P":
            return "2P";

        case "3P":
            return "3P";

        case "4P":
            return "4P";

        case "OT":
            return "OT";

        case "AP":
            return "AP";

        default:
            return shortStatus;
    }
}

function getMatchStatus(fixture) {
    const shortStatus = getShortStatus(fixture);

    const liveStatuses = [
        "1H",
        "HT",
        "2H",
        "ET",
        "BT",
        "P",
        "LIVE",
        "INT",
        "1P",
        "2P",
        "3P",
        "4P",
        "OT"
    ];

    const finishedStatuses = [
        "FT",
        "AET",
        "PEN"
    ];

    const cancelledStatuses = [
        "CANC",
        "ABD",
        "AWD",
        "WO"
    ];

    const postponedStatuses = [
        "PST",
        "SUSP"
    ];

    if (liveStatuses.indexOf(shortStatus) !== -1) {
        return "LIVE";
    }

    if (finishedStatuses.indexOf(shortStatus) !== -1) {
        return "FT";
    }

    if (cancelledStatuses.indexOf(shortStatus) !== -1) {
        return shortStatus;
    }

    if (postponedStatuses.indexOf(shortStatus) !== -1) {
        return shortStatus;
    }

    if (
        shortStatus === "NS" ||
        shortStatus === "TBD"
    ) {
        return "UPCOMING";
    }

    return shortStatus;
}

// ============================================
// API REQUEST
// ============================================

async function fetchFixtures(params, label) {
    if (!API_KEY) {
        throw new Error(
            "API_FOOTBALL_KEY secret is missing."
        );
    }

    const response = await axios.get(
        DEFAULT_API_URL,
        {
            params: Object.assign(
                {
                    timezone: TIME_ZONE
                },
                params
            ),

            headers: {
                "x-apisports-key": API_KEY
            },

            timeout: REQUEST_TIMEOUT
        }
    );

    const data = response.data || {};

    if (data.errors) {
        const errors = data.errors;

        if (
            typeof errors === "object" &&
            Object.keys(errors).length > 0
        ) {
            throw new Error(
                label + ": API error: " +
                JSON.stringify(errors)
            );
        }
    }

    if (!Array.isArray(data.response)) {
        throw new Error(
            label + ": API response is not an array."
        );
    }

    console.log(
        label + ": received " +
        data.response.length +
        " fixtures."
    );

    return data.response;
}

// ============================================
// FETCH ALL AVAILABLE FIXTURES
// ============================================

async function fetchAllFixtures() {
    const allFixtures = [];
    const fixtureMap = {};

    let successfulRequests = 0;
    let failedRequests = 0;

    async function collect(params, label) {
        try {
            const fixtures = await fetchFixtures(
                params,
                label
            );

            successfulRequests++;

            fixtures.forEach(function (fixture) {
                const fixtureId = normalizeId(
                    fixture &&
                    fixture.fixture &&
                    fixture.fixture.id
                );

                if (!fixtureId) {
                    return;
                }

                // Remove duplicates from live/date requests.
                if (!fixtureMap[fixtureId]) {
                    fixtureMap[fixtureId] = true;
                    allFixtures.push(fixture);
                }
            });
        } catch (error) {
            failedRequests++;

            console.error(
                label + " failed: " + error.message
            );
        }
    }

    // Fetch yesterday, today and tomorrow.
    const offsets = [-1, 0, 1];

    for (let i = 0; i < offsets.length; i++) {
        const date = getDateOffset(offsets[i]);

        await collect(
            {
                date: date
            },
            "Fixtures for " + date
        );

        await sleep(REQUEST_DELAY);
    }

    // Fetch currently live matches separately.
    // Duplicate fixture IDs are automatically ignored.
    await collect(
        {
            live: "all"
        },
        "All live fixtures"
    );

    console.log("");
    console.log("API FETCH SUMMARY");
    console.log("-----------------");
    console.log(
        "Successful requests: " + successfulRequests
    );
    console.log(
        "Failed requests: " + failedRequests
    );
    console.log(
        "Unique fixtures collected: " + allFixtures.length
    );

    // If every request failed, do not write or delete data.
    if (successfulRequests === 0) {
        throw new Error(
            "All API requests failed. " +
            "Firebase matches were not changed."
        );
    }

    return {
        fixtures: allFixtures,
        successfulRequests: successfulRequests,
        failedRequests: failedRequests
    };
}

// ============================================
// COMPETITION CONVERSION
// ============================================

function convertCompetition(
    fixture,
    existingCompetition,
    selected
) {
    const league = asObject(fixture.league);
    const existing = asObject(existingCompetition);

    const competitionId = normalizeId(league.id);

    return Object.assign(
        {},
        existing,
        {
            id: competitionId,
            competitionId: competitionId,
            name: cleanText(league.name, "Unknown League"),
            league: cleanText(league.name, "Unknown League"),
            country: cleanText(league.country, ""),
            logo: cleanText(league.logo, ""),
            flag: cleanText(league.flag, ""),
            season: toNumber(league.season, 0),
            sportId: 1,

            // Preserve the user's current selection.
            selected: selected,

            apiProvider: "apifootball",
            lastUpdated: Date.now()
        }
    );
}

// ============================================
// MATCH CONVERSION
// ============================================

function convertFixture(
    fixture,
    existingMatch,
    competitionSelected
) {
    const existing = asObject(existingMatch);

    const fixtureInfo = asObject(fixture.fixture);
    const league = asObject(fixture.league);
    const teams = asObject(fixture.teams);
    const goals = asObject(fixture.goals);
    const score = asObject(fixture.score);

    const home = asObject(teams.home);
    const away = asObject(teams.away);

    const venue = asObject(fixtureInfo.venue);

    const fixtureId = normalizeId(fixtureInfo.id);
    const competitionId = normalizeId(league.id);

    const timestamp = getTimestamp(fixture);

    const homeScore =
        goals.home === null || goals.home === undefined
            ? 0
            : toNumber(goals.home, 0);

    const awayScore =
        goals.away === null || goals.away === undefined
            ? 0
            : toNumber(goals.away, 0);

    const shortStatus = getShortStatus(fixture);
    const statusText = getStatusText(fixture);
    const matchStatus = getMatchStatus(fixture);

    const fixtureDate = cleanText(
        fixtureInfo.date,
        ""
    );

    const formattedDate = fixtureDate
        ? fixtureDate.substring(0, 10)
        : "";

    const formattedTime = fixtureDate
        ? fixtureDate.substring(11, 16)
        : "";

    const homeTeam = cleanText(
        home.name,
        "Home"
    );

    const awayTeam = cleanText(
        away.name,
        "Away"
    );

    const leagueName = cleanText(
        league.name,
        "Unknown League"
    );

    // Preserve admin-entered fields from the old match.
    const preservedFields = {
        streamUrl: existing.streamUrl || "",
        goalEvents: existing.goalEvents || {},
        adminNotes: existing.adminNotes || "",
        stadium: existing.stadium || "",
        channels: existing.channels || {},
        homeLogo: existing.homeLogo || "",
        awayLogo: existing.awayLogo || ""
    };

    const match = Object.assign(
        {},
        existing,
        {
            gameId: fixtureId,
            fixtureId: fixtureId,
            apiFixtureId: toNumber(fixtureId, fixtureId),

            apiProvider: "apifootball",

            competitionId: competitionId,
            competition: leagueName,
            league: leagueName,
            country: cleanText(league.country, ""),
            season: toNumber(league.season, 0),

            sportId: 1,

            homeTeam: homeTeam,
            awayTeam: awayTeam,

            home: homeTeam,
            away: awayTeam,

            homeTeamId: normalizeId(home.id),
            awayTeamId: normalizeId(away.id),

            homeScore: homeScore,
            awayScore: awayScore,

            // Keep compatibility with layouts using these fields.
            homeGoals: homeScore,
            awayGoals: awayScore,

            score: homeScore + " - " + awayScore,

            status: matchStatus,
            shortStatus: shortStatus,
            statusText: statusText,
            elapsed: getElapsed(fixture),

            date: formattedDate,
            time: formattedTime,
            fixtureDate: fixtureDate,

            timestamp: timestamp,
            matchTimeMillis: timestamp,

            venue: cleanText(venue.name, ""),
            lastUpdated: Date.now(),

            // The match is always saved, regardless of selection.
            // The app can use this field to filter its display.
            competitionSelected: competitionSelected,

            // API logos are used when available.
            homeTeamLogo: cleanText(
                home.logo,
                preservedFields.homeLogo
            ),

            awayTeamLogo: cleanText(
                away.logo,
                preservedFields.awayLogo
            ),

            homeLogo: cleanText(
                home.logo,
                preservedFields.homeLogo
            ),

            awayLogo: cleanText(
                away.logo,
                preservedFields.awayLogo
            ),

            // Keep existing admin information.
            streamUrl: preservedFields.streamUrl,
            goalEvents: preservedFields.goalEvents,
            adminNotes: preservedFields.adminNotes,
            stadium: preservedFields.stadium,
            channels: preservedFields.channels
        }
    );

    return match;
}

// ============================================
// MAIN SYNC
// ============================================

async function main() {
    initializeFirebase();

    const db = admin.database();

    console.log("====================================");
    console.log("SPORTS HUB API-FOOTBALL SYNC");
    console.log("====================================");

    // ----------------------------------------
    // 1. READ SETTINGS
    // ----------------------------------------

    const settingsSnapshot = await db
        .ref(SETTINGS_PATH)
        .once("value");

    const settings = asObject(
        settingsSnapshot.val()
    );

    if (!isApiFootballSelected(settings)) {
        console.log(
            "API-Football is not the selected provider."
        );

        console.log(
            "Skipping API-Football sync."
        );

        return;
    }

    // ----------------------------------------
    // 2. READ EXISTING FIREBASE DATA
    // ----------------------------------------

    const results = await Promise.all([
        db.ref(COMPETITIONS_PATH).once("value"),
        db.ref(SELECTION_PATH).once("value"),
        db.ref(MATCHES_PATH).once("value"),
        db.ref(SYNC_SETTINGS_PATH).once("value")
    ]);

    const competitions = asObject(results[0].val());
    const selectionData = asObject(results[1].val());
    const existingMatches = asObject(results[2].val());
    const syncSettings = asObject(results[3].val());

    const previousProvider = normalizeProvider(
        syncSettings.currentProvider
    );

    const providerChanged =
        previousProvider !== "" &&
        previousProvider !== "apifootball";

    console.log(
        "Previous provider: " +
        (previousProvider || "unknown")
    );

    console.log(
        "Provider changed: " + providerChanged
    );

    // ----------------------------------------
    // 3. FETCH FIXTURES
    // ----------------------------------------

    const fetchResult = await fetchAllFixtures();

    const fixtures = fetchResult.fixtures;

    if (fixtures.length === 0) {
        console.log(
            "No fixtures returned by the successful API requests."
        );

        console.log(
            "Existing Firebase matches will not be deleted."
        );

        // Do not perform provider cleanup on an empty result.
        // Update the provider marker only after non-empty sync.
        return;
    }

    // ----------------------------------------
    // 4. PREPARE FIREBASE UPDATES
    // ----------------------------------------

    const updates = {};

    let competitionCount = 0;
    let selectedCompetitionCount = 0;
    let selectedMatchCount = 0;
    let unselectedMatchCount = 0;
    let skippedFixtures = 0;

    const processedCompetitions = {};

    // ----------------------------------------
    // 5. PROCESS EVERY FIXTURE
    // ----------------------------------------

    fixtures.forEach(function (fixture) {
        const fixtureInfo = asObject(fixture.fixture);
        const league = asObject(fixture.league);

        const fixtureId = normalizeId(fixtureInfo.id);
        const competitionId = normalizeId(league.id);

        if (!fixtureId || !competitionId) {
            skippedFixtures++;
            return;
        }

        // Preserve current competition selection.
        const selectionValue = getSelectionValue(
            selectionData,
            competitionId
        );

        const selected = isCompetitionSelected(
            selectionValue
        );

        // Create/update competition only once per ID.
        if (!processedCompetitions[competitionId]) {
            processedCompetitions[competitionId] = true;

            const existingCompetition = asObject(
                competitions[competitionId]
            );

            const competition = convertCompetition(
                fixture,
                existingCompetition,
                selected
            );

            updates[
                COMPETITIONS_PATH + "/" + competitionId
            ] = competition;

            // Initialize selection only when missing.
            // Never overwrite a selection already in Firebase.
            if (
                selectionData[competitionId] === undefined ||
                selectionData[competitionId] === null
            ) {
                updates[
                    SELECTION_PATH + "/" + competitionId
                ] = {
                    selected: false,
                    competitionId: competitionId,
                    name: cleanText(
                        league.name,
                        "Unknown League"
                    ),
                    createdAt: Date.now()
                };
            }

            competitionCount++;

            if (selected) {
                selectedCompetitionCount++;
            }
        }

        // ------------------------------------
        // IMPORTANT:
        // Do NOT skip unselected competitions.
        // Save ALL fixtures to Firebase.
        // ------------------------------------

        const existingMatch = asObject(
            existingMatches[fixtureId]
        );

        const match = convertFixture(
            fixture,
            existingMatch,
            selected
        );

        updates[
            MATCHES_PATH + "/" + fixtureId
        ] = match;

        if (selected) {
            selectedMatchCount++;
        } else {
            unselectedMatchCount++;
        }
    });

    if (Object.keys(updates).length === 0) {
        console.log(
            "No valid fixture updates to write."
        );

        return;
    }

    // ----------------------------------------
    // 6. SAVE TO FIREBASE
    // ----------------------------------------

    await db.ref().update(updates);

    console.log("");
    console.log("FIREBASE SYNC SUMMARY");
    console.log("---------------------");

    console.log(
        "Unique fixtures received: " + fixtures.length
    );

    console.log(
        "Competitions processed: " + competitionCount
    );

    console.log(
        "Selected competitions: " + selectedCompetitionCount
    );

    console.log(
        "Matches in selected competitions: " + selectedMatchCount
    );

    console.log(
        "Matches in unselected competitions: " + unselectedMatchCount
    );

    console.log(
        "Invalid fixtures skipped: " + skippedFixtures
    );

    console.log(
        "Total Firebase paths updated: " +
        Object.keys(updates).length
    );

    // ----------------------------------------
    // 7. PROVIDER SWITCH CLEANUP
    // ----------------------------------------

    // Only remove old 365Scores football matches when:
    // - provider has actually changed;
    // - all requests succeeded;
    // - at least one fixture was received;
    // - the new provider's fixtures were saved successfully.
    //
    // If any request failed, keep old records to avoid
    // accidentally deleting data because of a partial API result.

    if (
        providerChanged &&
        fetchResult.failedRequests === 0 &&
        fixtures.length > 0
    ) {
        const cleanupUpdates = {};

        Object.keys(existingMatches).forEach(
            function (matchKey) {
                const match = asObject(
                    existingMatches[matchKey]
                );

                const provider = normalizeProvider(
                    match.apiProvider
                );

                const isFootball = (
                    toNumber(match.sportId, 1) === 1
                );

                if (
                    provider === "365scores" &&
                    isFootball
                ) {
                    cleanupUpdates[
                        MATCHES_PATH + "/" + matchKey
                    ] = null;
                }
            }
        );

        const cleanupKeys = Object.keys(cleanupUpdates);

        if (cleanupKeys.length > 0) {
            await db.ref().update(cleanupUpdates);

            console.log(
                "Removed old 365Scores football matches: " +
                cleanupKeys.length
            );
        } else {
            console.log(
                "No old 365Scores football matches to remove."
            );
        }
    } else if (providerChanged) {
        console.log(
            "Provider cleanup skipped because the fetch was partial or empty."
        );
    }

    // ----------------------------------------
    // 8. SAVE CURRENT PROVIDER
    // ----------------------------------------

    await db.ref(
        SYNC_SETTINGS_PATH + "/currentProvider"
    ).set("apifootball");

    await db.ref(
        SYNC_SETTINGS_PATH + "/lastApiFootballSync"
    ).set(Date.now());

    console.log("");
    console.log(
        "Sports Hub API-Football sync completed successfully."
    );
}

// ============================================
// RUN
// ============================================

main()
    .then(function () {
        console.log("Sync process finished.");
        process.exit(0);
    })
    .catch(function (error) {
        console.error("");
        console.error("SYNC FAILED");
        console.error(error && error.stack
            ? error.stack
            : error);

        process.exit(1);
    });

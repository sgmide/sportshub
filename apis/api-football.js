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
        serviceAccount = JSON.parse(
            SERVICE_ACCOUNT_JSON
        );
    } catch (error) {
        throw new Error(
            "FIREBASE_SERVICE_ACCOUNT is not valid JSON."
        );
    }

    admin.initializeApp({
        credential: admin.credential.cert(
            serviceAccount
        ),
        databaseURL: DATABASE_URL
    });
}

function sleep(milliseconds) {
    return new Promise(function (resolve) {
        setTimeout(resolve, milliseconds);
    });
}

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

function cleanText(value, fallback) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback || "";
    }

    return String(value);
}

function toNumber(value, fallback) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return fallback;
    }

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
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

function getDateOffset(offset) {
    const date = new Date();

    date.setUTCDate(
        date.getUTCDate() + offset
    );

    return date.getUTCFullYear() + "-" +
        String(date.getUTCMonth() + 1).padStart(2, "0") + "-" +
        String(date.getUTCDate()).padStart(2, "0");
}

function normalizeProvider(value) {
    const provider = cleanText(value, "")
        .toLowerCase()
        .trim();

    if (
        provider === "api-football" ||
        provider === "api_football" ||
        provider === "api football" ||
        provider === "apifootball"
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

// ============================================
// CHECK SELECTED PARSER
// ============================================

function isApiFootballSelected(settings) {
    const root = asObject(settings);

    const selectedParser = cleanText(
        root.selected_parser,
        "parse1"
    );

    const parseSettings = asObject(
        root.parse
    );

    const parser = asObject(
        parseSettings[selectedParser]
    );

    const provider = normalizeProvider(
        parser.api_parser
    );

    console.log(
        "Selected parser: " + selectedParser
    );

    console.log(
        "Selected API provider: " +
        (provider || "not configured")
    );

    return provider === "apifootball";
}

// ============================================
// COMPETITION SELECTION
// ============================================

function isCompetitionSelected(value) {
    if (
        value === true ||
        value === 1 ||
        value === "1" ||
        value === "true"
    ) {
        return true;
    }

    if (
        value === false ||
        value === 0 ||
        value === "0" ||
        value === "false" ||
        value === null ||
        value === undefined
    ) {
        return false;
    }

    // Also support legacy object format.
    if (typeof value === "object") {
        const object = asObject(value);

        if (object.selected !== undefined) {
            return isCompetitionSelected(
                object.selected
            );
        }

        if (object.enabled !== undefined) {
            return isCompetitionSelected(
                object.enabled
            );
        }
    }

    return false;
}

// ============================================
// API FOOTBALL STATUS
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
    const value =
        fixture &&
        fixture.fixture &&
        fixture.fixture.status &&
        fixture.fixture.status.elapsed;

    return toNumber(value, 0);
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
        case "2H":
        case "ET":
            return elapsed > 0
                ? elapsed + "'"
                : shortStatus;

        case "HT":
            return "HT";

        case "BT":
            return "BT";

        case "P":
        case "PEN":
            return "PEN";

        case "LIVE":
            return elapsed > 0
                ? elapsed + "'"
                : "LIVE";

        case "INT":
            return "INT";

        case "FT":
            return "FT";

        case "AET":
            return "AET";

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

        case "SUSP":
            return "SUSP";

        case "1P":
        case "2P":
        case "3P":
        case "4P":
        case "OT":
            return shortStatus;

        default:
            return shortStatus;
    }
}

function getMatchStatus(fixture) {
    const status = getShortStatus(fixture);

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

    const upcomingStatuses = [
        "NS",
        "TBD"
    ];

    if (liveStatuses.indexOf(status) !== -1) {
        return "LIVE";
    }

    if (finishedStatuses.indexOf(status) !== -1) {
        return "FT";
    }

    if (upcomingStatuses.indexOf(status) !== -1) {
        return "UPCOMING";
    }

    return status;
}

// ============================================
// TIMESTAMP AND DATE
// ============================================

function getTimestamp(fixture) {
    const fixtureInfo = asObject(
        fixture && fixture.fixture
    );

    const timestamp = toNumber(
        fixtureInfo.timestamp,
        0
    );

    if (timestamp > 0) {
        return timestamp * 1000;
    }

    const dateText = fixtureInfo.date;

    if (dateText) {
        const parsed = Date.parse(dateText);

        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return 0;
}

function formatDate(timestamp, fixture) {
    if (!timestamp) {
        const fixtureDate =
            fixture &&
            fixture.fixture &&
            fixture.fixture.date;

        return fixtureDate
            ? fixtureDate.substring(0, 10)
            : "";
    }

    const parts = new Intl.DateTimeFormat(
        "en-GB",
        {
            timeZone: TIME_ZONE,
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }
    ).formatToParts(new Date(timestamp));

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    return values.day + "-" +
        values.month + "-" +
        values.year;
}

function formatTime(timestamp, fixture) {
    if (!timestamp) {
        const fixtureDate =
            fixture &&
            fixture.fixture &&
            fixture.fixture.date;

        return fixtureDate
            ? fixtureDate.substring(11, 16)
            : "";
    }

    return new Intl.DateTimeFormat(
        "en-US",
        {
            timeZone: TIME_ZONE,
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        }
    ).format(new Date(timestamp));
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
                label + ": " +
                JSON.stringify(errors)
            );
        }
    }

    if (!Array.isArray(data.response)) {
        throw new Error(
            label + ": Invalid API response."
        );
    }

    console.log(
        label + ": " +
        data.response.length +
        " fixtures received."
    );

    return data.response;
}

// ============================================
// FETCH FIXTURES
// ============================================

async function fetchAllFixtures() {
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
                const id = normalizeId(
                    fixture &&
                    fixture.fixture &&
                    fixture.fixture.id
                );

                if (id) {
                    fixtureMap[id] = fixture;
                }
            });
        } catch (error) {
            failedRequests++;

            console.error(
                label + " failed: " +
                error.message
            );
        }
    }

    const offsets = [-1, 0, 1];

    for (let i = 0; i < offsets.length; i++) {
        const date = getDateOffset(offsets[i]);

        await collect(
            {
                date: date
            },
            "Fixtures " + date
        );

        await sleep(REQUEST_DELAY);
    }

    await collect(
        {
            live: "all"
        },
        "Live fixtures"
    );

    const fixtures = Object.keys(
        fixtureMap
    ).map(function (id) {
        return fixtureMap[id];
    });

    console.log("");
    console.log("API FETCH SUMMARY");
    console.log("-----------------");
    console.log(
        "Successful requests: " +
        successfulRequests
    );
    console.log(
        "Failed requests: " +
        failedRequests
    );
    console.log(
        "Unique fixtures: " +
        fixtures.length
    );

    if (successfulRequests === 0) {
        throw new Error(
            "All API requests failed. " +
            "Firebase data was not changed."
        );
    }

    return {
        fixtures: fixtures,
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
    const existing = asObject(
        existingCompetition
    );

    const league = asObject(
        fixture.league
    );

    const competitionId = normalizeId(
        league.id
    );

    return Object.assign(
        {},
        existing,
        {
            id: competitionId,
            competitionId: competitionId,

            name: cleanText(
                league.name,
                "Unknown League"
            ),

            league: cleanText(
                league.name,
                "Unknown League"
            ),

            country: cleanText(
                league.country,
                ""
            ),

            logo: cleanText(
                league.logo,
                ""
            ),

            flag: cleanText(
                league.flag,
                ""
            ),

            season: toNumber(
                league.season,
                0
            ),

            sportId: 1,
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
    const existing = asObject(
        existingMatch
    );

    const fixtureInfo = asObject(
        fixture.fixture
    );

    const league = asObject(
        fixture.league
    );

    const teams = asObject(
        fixture.teams
    );

    const goals = asObject(
        fixture.goals
    );

    const home = asObject(
        teams.home
    );

    const away = asObject(
        teams.away
    );

    const venue = asObject(
        fixtureInfo.venue
    );

    const fixtureId = normalizeId(
        fixtureInfo.id
    );

    const competitionId = normalizeId(
        league.id
    );

    const timestamp = getTimestamp(
        fixture
    );

    // Do not convert missing scores into 0.
    const hasHomeScore =
        goals.home !== null &&
        goals.home !== undefined;

    const hasAwayScore =
        goals.away !== null &&
        goals.away !== undefined;

    const homeScore = hasHomeScore
        ? toNumber(goals.home, null)
        : existing.homeScore !== undefined
            ? existing.homeScore
            : null;

    const awayScore = hasAwayScore
        ? toNumber(goals.away, null)
        : existing.awayScore !== undefined
            ? existing.awayScore
            : null;

    let scoreText = existing.score || "VS";

    if (
        hasHomeScore &&
        hasAwayScore
    ) {
        scoreText =
            homeScore + " - " + awayScore;
    }

    const homeName = cleanText(
        home.name,
        existing.home || existing.homeTeam || "Home"
    );

    const awayName = cleanText(
        away.name,
        existing.away || existing.awayTeam || "Away"
    );

    const leagueName = cleanText(
        league.name,
        existing.league || "Unknown League"
    );

    const homeLogo = cleanText(
        home.logo,
        existing.homeLogo || existing.homeTeamLogo || ""
    );

    const awayLogo = cleanText(
        away.logo,
        existing.awayLogo || existing.awayTeamLogo || ""
    );

    const status = getMatchStatus(
        fixture
    );

    const shortStatus = getShortStatus(
        fixture
    );

    const statusText = getStatusText(
        fixture
    );

    const match = Object.assign(
        {},
        existing,
        {
            gameId: fixtureId,
            fixtureId: fixtureId,
            apiFixtureId: toNumber(
                fixtureId,
                fixtureId
            ),

            apiProvider: "apifootball",

            competitionId: competitionId,
            competition: leagueName,
            league: leagueName,

            country: cleanText(
                league.country,
                existing.country || ""
            ),

            season: toNumber(
                league.season,
                existing.season || 0
            ),

            sportId: 1,

            home: homeName,
            away: awayName,

            homeTeam: homeName,
            awayTeam: awayName,

            homeTeamId: normalizeId(home.id),
            awayTeamId: normalizeId(away.id),

            homeScore: homeScore,
            awayScore: awayScore,

            homeGoals: homeScore,
            awayGoals: awayScore,

            score: scoreText,

            status: status,
            shortStatus: shortStatus,
            statusText: statusText,
            elapsed: getElapsed(fixture),

            date: formatDate(
                timestamp,
                fixture
            ),

            time: formatTime(
                timestamp,
                fixture
            ),

            fixtureDate: cleanText(
                fixtureInfo.date,
                existing.fixtureDate || ""
            ),

            timestamp: timestamp || existing.timestamp || 0,

            matchTimeMillis:
                timestamp ||
                existing.matchTimeMillis ||
                0,

            venue: cleanText(
                venue.name,
                existing.venue || ""
            ),

            stadium: existing.stadium ||
                cleanText(venue.name, ""),

            homeLogo: homeLogo,
            awayLogo: awayLogo,

            homeTeamLogo: homeLogo,
            awayTeamLogo: awayLogo,

            competitionSelected: competitionSelected,

            // Preserve all admin-managed fields.
            streamUrl: existing.streamUrl || "",
            goalEvents: existing.goalEvents || {},
            adminNotes: existing.adminNotes || "",
            channels: existing.channels || {},

            lastUpdated: Date.now()
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

    // 1. Read settings.

    const settingsSnapshot = await db
        .ref(SETTINGS_PATH)
        .once("value");

    const settings = asObject(
        settingsSnapshot.val()
    );

    if (!isApiFootballSelected(settings)) {
        console.log(
            "API-Football is not selected. Sync skipped."
        );

        return;
    }

    // 2. Read existing Firebase data.

    const results = await Promise.all([
        db.ref(COMPETITIONS_PATH).once("value"),
        db.ref(SELECTION_PATH).once("value"),
        db.ref(MATCHES_PATH).once("value"),
        db.ref(SYNC_SETTINGS_PATH).once("value")
    ]);

    const competitions = asObject(
        results[0].val()
    );

    const selectionData = asObject(
        results[1].val()
    );

    const existingMatches = asObject(
        results[2].val()
    );

    const syncSettings = asObject(
        results[3].val()
    );

    console.log(
        "Existing matches: " +
        Object.keys(existingMatches).length
    );

    console.log(
        "Existing competitions: " +
        Object.keys(competitions).length
    );

    // 3. Fetch fixtures.

    const fetchResult = await fetchAllFixtures();

    const fixtures = fetchResult.fixtures;

    if (fixtures.length === 0) {
        console.log(
            "No fixtures received. Existing matches preserved."
        );

        return;
    }

    // 4. Prepare updates.

    const updates = {};

    const processedCompetitions = {};

    let competitionCount = 0;
    let selectedCompetitionCount = 0;
    let selectedMatchCount = 0;
    let unselectedMatchCount = 0;
    let skippedFixtures = 0;

    // 5. Process all fixtures.

    fixtures.forEach(function (fixture) {
        const fixtureInfo = asObject(
            fixture.fixture
        );

        const league = asObject(
            fixture.league
        );

        const fixtureId = normalizeId(
            fixtureInfo.id
        );

        const competitionId = normalizeId(
            league.id
        );

        if (
            !fixtureId ||
            !competitionId
        ) {
            skippedFixtures++;
            return;
        }

        const selectionValue =
            selectionData[competitionId];

        const selected = isCompetitionSelected(
            selectionValue
        );

        // Update competition once per competition ID.

        if (!processedCompetitions[competitionId]) {
            processedCompetitions[competitionId] = true;

            const existingCompetition = asObject(
                competitions[competitionId]
            );

            updates[
                COMPETITIONS_PATH +
                "/" +
                competitionId
            ] = convertCompetition(
                fixture,
                existingCompetition,
                selected
            );

            // Initialize missing selection as false.
            // Existing selection is never overwritten.
            if (
                selectionData[competitionId] === undefined ||
                selectionData[competitionId] === null
            ) {
                updates[
                    SELECTION_PATH +
                    "/" +
                    competitionId
                ] = false;
            }

            competitionCount++;

            if (selected) {
                selectedCompetitionCount++;
            }
        }

        // Save ALL fixtures.
        // Selection affects display only.

        const existingMatch = asObject(
            existingMatches[fixtureId]
        );

        updates[
            MATCHES_PATH +
            "/" +
            fixtureId
        ] = convertFixture(
            fixture,
            existingMatch,
            selected
        );

        if (selected) {
            selectedMatchCount++;
        } else {
            unselectedMatchCount++;
        }
    });

    // 6. Save Firebase updates.

    if (Object.keys(updates).length === 0) {
        console.log(
            "No valid fixture updates."
        );

        return;
    }

    await db.ref().update(updates);

    // 7. Update sync status.
    // No automatic match deletion.

    const now = Date.now();

    await db.ref(
        SYNC_SETTINGS_PATH
    ).update({
        currentProvider: "apifootball",
        lastApiFootballSync: now,
        lastSuccessfulSync: now,
        lastSyncStatus: "success",
        lastSyncFixtureCount: fixtures.length,
        lastSyncFailedRequests:
            fetchResult.failedRequests
    });

    console.log("");
    console.log("FIREBASE SYNC SUMMARY");
    console.log("---------------------");

    console.log(
        "Fixtures received: " + fixtures.length
    );

    console.log(
        "Competitions processed: " + competitionCount
    );

    console.log(
        "Selected competitions: " +
        selectedCompetitionCount
    );

    console.log(
        "Matches in selected competitions: " +
        selectedMatchCount
    );

    console.log(
        "Matches in unselected competitions: " +
        unselectedMatchCount
    );

    console.log(
        "Invalid fixtures skipped: " +
        skippedFixtures
    );

    console.log(
        "Failed API requests: " +
        fetchResult.failedRequests
    );

    console.log(
        "Firebase paths updated: " +
        Object.keys(updates).length
    );

    console.log(
        "Existing matches were not deleted."
    );

    console.log("");
    console.log(
        "Sports Hub API-Football sync completed."
    );
}

// ============================================
// RUN
// ============================================

main()
    .then(function () {
        console.log(
            "Sync process finished."
        );

        process.exit(0);
    })
    .catch(async function (error) {
        console.error("");
        console.error("SYNC FAILED");

        console.error(
            error && error.stack
                ? error.stack
                : error
        );

        process.exit(1);
    });

"use strict";

const admin = require("firebase-admin");
const axios = require("axios");

const DEFAULT_API_URL =
    "https://v3.football.api-sports.io/fixtures";

const TIME_ZONE = "Asia/Kolkata";
const REQUEST_TIMEOUT = 30000;
const REQUEST_DELAY = 500;

const API_KEY =
    process.env.API_FOOTBALL_KEY || "";

const CURRENT_PROVIDER = "apifootball";

const PROVIDER_STATE_PATH =
    "syncSettings/currentProvider";

const MATCHES_PATH = "matches";
const COMPETITIONS_PATH = "competitions";
const SELECTION_PATH = "competition_selection";

// ==================================================
// FIREBASE
// ==================================================

function initializeFirebase() {
    if (admin.apps.length > 0) {
        return admin.database();
    }

    const serviceAccountJson =
        process.env.FIREBASE_SERVICE_ACCOUNT;

    const databaseURL =
        process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountJson) {
        throw new Error(
            "Missing FIREBASE_SERVICE_ACCOUNT secret"
        );
    }

    if (!databaseURL) {
        throw new Error(
            "Missing FIREBASE_DATABASE_URL secret"
        );
    }

    const serviceAccount =
        JSON.parse(serviceAccountJson);

    admin.initializeApp({
        credential: admin.credential.cert(
            serviceAccount
        ),
        databaseURL: databaseURL
    });

    return admin.database();
}

// ==================================================
// PROVIDER HELPERS
// ==================================================

function normalizeProvider(value) {
    const provider = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]/g, "");

    if (
        provider === "365scores" ||
        provider === "365"
    ) {
        return "365scores";
    }

    if (
        provider === "apifootball" ||
        provider === "apisports" ||
        provider === "football"
    ) {
        return "apifootball";
    }

    return "";
}

function getMatchProvider(match) {
    if (!match || typeof match !== "object") {
        return "";
    }

    return normalizeProvider(
        match.apiProvider ||
        match.provider ||
        match.apiSource ||
        ""
    );
}

// ==================================================
// DATE HELPERS
// ==================================================

function getDateOffset(days) {
    const parts = new Intl.DateTimeFormat(
        "en-GB",
        {
            timeZone: TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }
    ).formatToParts(new Date());

    const values = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }

    const date = new Date(
        Date.UTC(
            Number(values.year),
            Number(values.month) - 1,
            Number(values.day) + days,
            12,
            0,
            0
        )
    );

    return [
        date.getUTCFullYear(),
        String(
            date.getUTCMonth() + 1
        ).padStart(2, "0"),
        String(
            date.getUTCDate()
        ).padStart(2, "0")
    ].join("-");
}

function getAllowedDates() {
    return new Set([
        getDateOffset(-1),
        getDateOffset(0),
        getDateOffset(1)
    ]);
}

function getIndiaDateFromTimestamp(timestamp) {
    const date = new Date(timestamp);

    if (isNaN(date.getTime())) {
        return "";
    }

    const parts = new Intl.DateTimeFormat(
        "en-CA",
        {
            timeZone: TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }
    ).formatToParts(date);

    const values = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }

    return (
        values.year + "-" +
        values.month + "-" +
        values.day
    );
}

function formatMatchDate(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (isNaN(date.getTime())) {
        return "";
    }

    const parts = new Intl.DateTimeFormat(
        "en-GB",
        {
            timeZone: TIME_ZONE,
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }
    ).formatToParts(date);

    const values = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }

    return (
        values.day + "-" +
        values.month + "-" +
        values.year
    );
}

function formatMatchTime(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat(
        "en-US",
        {
            timeZone: TIME_ZONE,
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        }
    ).format(date);
}

// ==================================================
// API REQUEST
// ==================================================

async function fetchFixtures(date) {
    if (!API_KEY) {
        throw new Error(
            "Missing API_FOOTBALL_KEY secret"
        );
    }

    console.log(
        "Fetching API-Football:",
        date
    );

    const response = await axios.get(
        DEFAULT_API_URL,
        {
            params: {
                date: date,
                timezone: TIME_ZONE
            },
            headers: {
                "x-apisports-key": API_KEY,
                "Accept": "application/json"
            },
            timeout: REQUEST_TIMEOUT
        }
    );

    const data = response.data;

    if (
        data &&
        data.errors &&
        (
            Array.isArray(data.errors)
                ? data.errors.length > 0
                : Object.keys(
                    data.errors
                ).length > 0
        )
    ) {
        throw new Error(
            "API-Football error: " +
            JSON.stringify(data.errors)
        );
    }

    if (
        !data ||
        !Array.isArray(data.response)
    ) {
        throw new Error(
            "Invalid API-Football response"
        );
    }

    console.log(
        "Fixtures received for " + date + ":",
        data.response.length
    );

    return data.response;
}

// ==================================================
// MATCH STATUS
// ==================================================

function getMatchStatus(item) {
    const status =
        item.fixture &&
        item.fixture.status
            ? item.fixture.status
            : {};

    const code = String(
        status.short || "NS"
    ).toUpperCase();

    const elapsed =
        status.elapsed == null
            ? null
            : status.elapsed;

    const map = {
        PST: ["Postponed", "PPD"],
        CANC: ["Cancelled", "CANC"],
        ABD: ["Abandoned", "ABD"],
        AWD: ["Awarded", "AWD"],
        WO: ["Walkover", "WO"],
        PEN: ["After Penalties", "AP"],
        AET: ["After Extra Time", "AET"],
        HT: ["Half Time", "HT"],
        ET: ["Extra Time", "ET"],
        BT: ["Break Time", "BT"],
        FT: ["Finished", "FT"],
        NS: ["Upcoming", "NS"],
        TBD: ["Upcoming", "NS"],
        SUSP: ["Suspended", "SUSP"],
        INT: ["Interrupted", "INT"]
    };

    if (map[code]) {
        return {
            status: map[code][0],
            shortStatus: map[code][1],
            elapsed: elapsed
        };
    }

    if (
        [
            "1H",
            "2H",
            "3H",
            "4H",
            "5H",
            "LIVE"
        ].indexOf(code) !== -1
    ) {
        return {
            status: "Live",
            shortStatus:
                elapsed == null
                    ? code
                    : String(elapsed) + "'",
            elapsed: elapsed
        };
    }

    return {
        status: status.long || "Upcoming",
        shortStatus: code,
        elapsed: elapsed
    };
}

// ==================================================
// CONVERT FIXTURE
// ==================================================

function convertFixture(item, oldMatch) {
    const fixture = item.fixture || {};
    const league = item.league || {};
    const teams = item.teams || {};
    const goals = item.goals || {};

    const home = teams.home || {};
    const away = teams.away || {};

    const fixtureId = Number(fixture.id);
    const timestamp = Date.parse(fixture.date);

    if (
        !Number.isInteger(fixtureId) ||
        fixtureId <= 0 ||
        !Number.isFinite(timestamp)
    ) {
        return null;
    }

    const previous = oldMatch || {};

    const homeScore =
        goals.home == null ? "" : goals.home;

    const awayScore =
        goals.away == null ? "" : goals.away;

    const status = getMatchStatus(item);

    // Preserve admin-entered fields.
    const preservedFields = [
        "streamUrl",
        "goalEvents",
        "adminNotes",
        "stadium",
        "homeLogo",
        "awayLogo",
        "channels",
        "channelId",
        "channelName",
        "customFields"
    ];

    const preserved = {};

    for (const key of preservedFields) {
        if (
            Object.prototype.hasOwnProperty.call(
                previous,
                key
            )
        ) {
            preserved[key] = previous[key];
        }
    }

    const match = Object.assign(
        {},
        preserved,
        {
            gameId: fixtureId,
            fixtureId: fixtureId,
            apiFixtureId: fixtureId,

            apiProvider: CURRENT_PROVIDER,

            competitionId:
                league.id == null
                    ? null
                    : Number(league.id),

            league:
                league.name ||
                "Unknown Competition",

            competition:
                league.name ||
                "Unknown Competition",

            country: league.country || "",
            season: league.season || null,

            sportId: 1,

            home: home.name || "Home",
            away: away.name || "Away",

            homeTeamId:
                home.id == null
                    ? 0
                    : Number(home.id),

            awayTeamId:
                away.id == null
                    ? 0
                    : Number(away.id),

            homeScore: homeScore,
            awayScore: awayScore,

            score:
                homeScore !== "" &&
                awayScore !== ""
                    ? homeScore + " - " + awayScore
                    : "VS",

            status: status.status,
            shortStatus: status.shortStatus,
            elapsed: status.elapsed,

            date: formatMatchDate(
                fixture.date
            ),

            time: formatMatchTime(
                fixture.date
            ),

            timestamp: Math.floor(
                timestamp / 1000
            ),

            matchTimeMillis: timestamp,

            lastUpdated: Date.now()
        }
    );

    if (!match.stadium) {
        match.stadium =
            fixture.venue &&
            fixture.venue.name
                ? fixture.venue.name
                : "";
    }

    if (!match.homeLogo) {
        match.homeLogo = home.logo || "";
    }

    if (!match.awayLogo) {
        match.awayLogo = away.logo || "";
    }

    return match;
}

// ==================================================
// LEGACY 365SCORES DETECTION
// ==================================================

function is365ScoresFootballMatch(match) {
    if (
        !match ||
        typeof match !== "object"
    ) {
        return false;
    }

    if (String(match.sportId) !== "1") {
        return false;
    }

    const provider = getMatchProvider(match);

    if (provider === "365scores") {
        return true;
    }

    if (provider === "apifootball") {
        return false;
    }

    const homeLogo = String(
        match.homeLogo || ""
    ).toLowerCase();

    const awayLogo = String(
        match.awayLogo || ""
    ).toLowerCase();

    const has365ScoresLogo =
        homeLogo.indexOf(
            "imagecache.365scores.com"
        ) !== -1 ||
        awayLogo.indexOf(
            "imagecache.365scores.com"
        ) !== -1;

    const hasCompetitorIds =
        match.homeCompetitorId != null &&
        match.awayCompetitorId != null;

    return (
        has365ScoresLogo &&
        hasCompetitorIds
    );
}

// ==================================================
// PROVIDER INFERENCE
// ==================================================

function inferPreviousProvider(existingMatches) {
    const providers = new Set();

    for (const matchId of Object.keys(
        existingMatches || {}
    )) {
        const match = existingMatches[matchId];

        if (!match || typeof match !== "object") {
            continue;
        }

        if (String(match.sportId) !== "1") {
            continue;
        }

        const provider = getMatchProvider(match);

        if (provider) {
            providers.add(provider);
        } else if (
            is365ScoresFootballMatch(match)
        ) {
            providers.add("365scores");
        }
    }

    if (providers.size === 1) {
        return Array.from(providers)[0];
    }

    return "";
}

// ==================================================
// COMPETITION SELECTION
// ==================================================

function isCompetitionSelected(
    selection,
    oldCompetition
) {
    if (selection === true) {
        return true;
    }

    if (
        selection &&
        typeof selection === "object" &&
        selection.selected === true
    ) {
        return true;
    }

    if (selection === false) {
        return false;
    }

    if (
        selection &&
        typeof selection === "object" &&
        selection.selected === false
    ) {
        return false;
    }

    return !!(
        oldCompetition &&
        oldCompetition.selected === true
    );
}

// ==================================================
// OLD MATCH DATE
// ==================================================

function getExistingMatchDate(match) {
    if (!match || typeof match !== "object") {
        return "";
    }

    // Prefer accurate millisecond timestamp.
    if (match.matchTimeMillis != null) {
        const millis = Number(
            match.matchTimeMillis
        );

        if (
            Number.isFinite(millis) &&
            millis > 0
        ) {
            return getIndiaDateFromTimestamp(millis);
        }
    }

    // Older records may store seconds.
    if (match.timestamp != null) {
        const timestamp = Number(match.timestamp);

        if (
            Number.isFinite(timestamp) &&
            timestamp > 0
        ) {
            const millis =
                timestamp < 100000000000
                    ? timestamp * 1000
                    : timestamp;

            return getIndiaDateFromTimestamp(millis);
        }
    }

    // API fixture date is ISO format.
    if (
        match.fixtureDate ||
        match.kickoff ||
        match.dateTime
    ) {
        const value =
            match.fixtureDate ||
            match.kickoff ||
            match.dateTime;

        const millis = Date.parse(value);

        if (Number.isFinite(millis)) {
            return getIndiaDateFromTimestamp(millis);
        }
    }

    // Match date may be dd-MM-yyyy.
    const textDate = String(
        match.date || ""
    ).trim();

    const matchDate = textDate.match(
        /^(\d{2})-(\d{2})-(\d{4})$/
    );

    if (matchDate) {
        return (
            matchDate[3] + "-" +
            matchDate[2] + "-" +
            matchDate[1]
        );
    }

    // Or ISO yyyy-MM-dd.
    const isoDate = textDate.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
    );

    if (isoDate) {
        return textDate;
    }

    return "";
}

// ==================================================
// MAIN
// ==================================================

async function main() {
    const db = initializeFirebase();

    console.log("==================================");
    console.log("SportsHub API-Football Sync");
    console.log("==================================");

    if (!API_KEY) {
        throw new Error(
            "API_FOOTBALL_KEY secret is missing"
        );
    }

    // ----------------------------------------------
    // Parser settings
    // ----------------------------------------------

    const settingsSnapshot =
        await db.ref("settings").once("value");

    const settings =
        settingsSnapshot.val() || {};

    const selectedParser = String(
        settings.selected_parser || "parse1"
    );

    const parserConfig =
        settings.parse &&
        settings.parse[selectedParser]
            ? settings.parse[selectedParser]
            : {};

    const apiParser = String(
        parserConfig.api_parser || ""
    ).trim().toLowerCase();

    if (
        apiParser &&
        [
            "apifootball",
            "api-football",
            "football",
            "apisports"
        ].indexOf(apiParser) === -1
    ) {
        throw new Error(
            "Selected parser is not API-Football: " +
            apiParser
        );
    }

    console.log("Selected parser:", selectedParser);
    console.log("Current provider:", CURRENT_PROVIDER);

    // ----------------------------------------------
    // Read existing data
    // ----------------------------------------------

    const results = await Promise.all([
        db.ref(SELECTION_PATH).once("value"),
        db.ref(COMPETITIONS_PATH).once("value"),
        db.ref(MATCHES_PATH).once("value"),
        db.ref(PROVIDER_STATE_PATH).once("value")
    ]);

    const competitionSelection =
        results[0].val() || {};

    const existingCompetitions =
        results[1].val() || {};

    const existingMatches =
        results[2].val() || {};

    let previousProvider = normalizeProvider(
        results[3].val()
    );

    if (!previousProvider) {
        previousProvider =
            inferPreviousProvider(existingMatches);
    }

    console.log(
        "Previous provider:",
        previousProvider || "unknown"
    );

    const providerSwitchDetected =
        previousProvider !== "" &&
        previousProvider !== CURRENT_PROVIDER;

    console.log(
        "Provider switch detected:",
        providerSwitchDetected
    );

    // ----------------------------------------------
    // Allowed dates: yesterday, today, tomorrow
    // ----------------------------------------------

    const allowedDates = getAllowedDates();

    console.log(
        "Allowed dates:",
        Array.from(allowedDates).join(", ")
    );

    // ----------------------------------------------
    // Fetch all three dates
    // ----------------------------------------------

    const discoveredFixtures = [];

    let successfulRequests = 0;
    let failedRequests = 0;

    for (const offset of [-1, 0, 1]) {
        const date = getDateOffset(offset);

        try {
            const fixtures = await fetchFixtures(date);

            discoveredFixtures.push.apply(
                discoveredFixtures,
                fixtures
            );

            successfulRequests++;

        } catch (error) {
            failedRequests++;

            console.error(
                "Fixture request failed:",
                date,
                error.response &&
                error.response.data
                    ? JSON.stringify(error.response.data)
                    : error.message
            );
        }

        await new Promise(function(resolve) {
            setTimeout(resolve, REQUEST_DELAY);
        });
    }

    const allRequestsSucceeded =
        successfulRequests === 3 &&
        failedRequests === 0;

    if (!allRequestsSucceeded) {
        throw new Error(
            "One or more date requests failed. " +
            "Cleanup cancelled to protect Firebase data."
        );
    }

    // ----------------------------------------------
    // Deduplicate fixtures
    // ----------------------------------------------

    const fixturesById = {};

    for (const item of discoveredFixtures) {
        const fixture = item.fixture || {};
        const fixtureId = Number(fixture.id);

        if (
            !Number.isInteger(fixtureId) ||
            fixtureId <= 0 ||
            !fixture.date
        ) {
            continue;
        }

        const fixtureDate = getIndiaDateFromTimestamp(
            Date.parse(fixture.date)
        );

        if (!allowedDates.has(fixtureDate)) {
            continue;
        }

        fixturesById[String(fixtureId)] = item;
    }

    const uniqueFixtures = Object.keys(
        fixturesById
    ).map(function(id) {
        return fixturesById[id];
    });

    console.log(
        "Unique fixtures in allowed dates:",
        uniqueFixtures.length
    );

    // ----------------------------------------------
    // Process competitions and selected matches
    // ----------------------------------------------

    const competitionUpdates = {};
    const selectionUpdates = {};
    const matchUpdates = {};

    const selectedCompetitionIds = new Set();

    let newCompetitionCount = 0;
    let selectedMatchCount = 0;

    for (const item of uniqueFixtures) {
        const league = item.league || {};

        const competitionId = Number(league.id);

        if (
            !Number.isInteger(competitionId) ||
            competitionId <= 0
        ) {
            continue;
        }

        const competitionKey =
            String(competitionId);

        const oldCompetition =
            existingCompetitions[competitionKey] || {};

        const hasSelection =
            Object.prototype.hasOwnProperty.call(
                competitionSelection,
                competitionKey
            );

        const selected = isCompetitionSelected(
            hasSelection
                ? competitionSelection[competitionKey]
                : undefined,
            oldCompetition
        );

        const competitionName =
            league.name || "Unknown Competition";

        competitionUpdates[competitionKey] = {
            id: competitionId,
            name: competitionName,
            sportId: 1,
            selected: selected,
            country: league.country || "",
            season: league.season || null
        };

        if (!oldCompetition.id) {
            newCompetitionCount++;
        }

        // Add missing selection entry only.
        if (!hasSelection) {
            selectionUpdates[competitionKey] = selected;
        }

        if (!selected) {
            continue;
        }

        selectedCompetitionIds.add(competitionKey);

        const fixtureId = Number(
            item.fixture &&
            item.fixture.id
        );

        if (
            !Number.isInteger(fixtureId) ||
            fixtureId <= 0
        ) {
            continue;
        }

        const fixtureKey = String(fixtureId);

        const oldMatch =
            existingMatches[fixtureKey] || {};

        const match = convertFixture(
            item,
            oldMatch
        );

        if (!match) {
            continue;
        }

        matchUpdates[fixtureKey] = match;

        selectedMatchCount++;
    }

    // ----------------------------------------------
    // Prepare Firebase updates
    // ----------------------------------------------

    const updates = {};

    for (const key of Object.keys(competitionUpdates)) {
        updates[
            COMPETITIONS_PATH + "/" + key
        ] = competitionUpdates[key];
    }

    for (const key of Object.keys(selectionUpdates)) {
        updates[
            SELECTION_PATH + "/" + key
        ] = selectionUpdates[key];
    }

    for (const key of Object.keys(matchUpdates)) {
        updates[
            MATCHES_PATH + "/" + key
        ] = matchUpdates[key];
    }

    // ----------------------------------------------
    // CLEANUP OLD API MATCHES
    // ----------------------------------------------

    let deletedOldApiCount = 0;
    let deletedOutOfDateCount = 0;
    let deletedUnselectedCount = 0;
    let deleted365ScoresCount = 0;
    let skippedUnknownProviderCount = 0;

    /*
     * Do not delete data after an empty response.
     * This prevents accidental mass deletion if the
     * API returns no fixtures unexpectedly.
     *
     * If there are genuinely zero fixtures across all
     * three days, cleanup is skipped for safety.
     */
    const safeToCleanup =
        allRequestsSucceeded &&
        uniqueFixtures.length > 0;

    if (safeToCleanup) {
        const refreshedMatchIds = new Set(
            Object.keys(matchUpdates)
        );

        for (const matchId of Object.keys(existingMatches)) {
            const oldMatch = existingMatches[matchId];

            if (
                !oldMatch ||
                typeof oldMatch !== "object"
            ) {
                continue;
            }

            // Preserve other sports.
            if (String(oldMatch.sportId) !== "1") {
                continue;
            }

            // If the match was refreshed in this run,
            // retain the fresh record.
            if (refreshedMatchIds.has(matchId)) {
                continue;
            }

            const oldProvider =
                getMatchProvider(oldMatch);

            // --------------------------------------
            // Explicit API-Football records
            // --------------------------------------

            if (oldProvider === CURRENT_PROVIDER) {
                const oldCompetitionId = String(
                    oldMatch.competitionId != null
                        ? oldMatch.competitionId
                        : oldMatch.leagueId != null
                            ? oldMatch.leagueId
                            : ""
                );

                const oldDate =
                    getExistingMatchDate(oldMatch);

                // Remove API-Football records outside
                // yesterday, today, tomorrow.
                if (
                    oldDate &&
                    !allowedDates.has(oldDate)
                ) {
                    updates[
                        MATCHES_PATH + "/" + matchId
                    ] = null;

                    deletedOutOfDateCount++;
                    continue;
                }

                // Remove old records whose competition
                // is no longer selected.
                if (
                    oldCompetitionId &&
                    !selectedCompetitionIds.has(
                        oldCompetitionId
                    )
                ) {
                    const selection =
                        competitionSelection[
                            oldCompetitionId
                        ];

                    const competition =
                        existingCompetitions[
                            oldCompetitionId
                        ];

                    const selectedNow =
                        isCompetitionSelected(
                            selection,
                            competition
                        );

                    if (!selectedNow) {
                        updates[
                            MATCHES_PATH + "/" + matchId
                        ] = null;

                        deletedUnselectedCount++;
                    }

                    continue;
                }

                /*
                 * If the date cannot be identified, do
                 * not delete based on date alone.
                 *
                 * If the fixture is absent from a
                 * complete API response, it may no
                 * longer be returned by the API.
                 */
                if (!oldDate) {
                    console.log(
                        "Keeping match with unknown date:",
                        matchId
                    );
                }

                continue;
            }

            // --------------------------------------
            // Previous API provider
            // --------------------------------------

            if (
                providerSwitchDetected &&
                previousProvider &&
                oldProvider === previousProvider
            ) {
                updates[
                    MATCHES_PATH + "/" + matchId
                ] = null;

                deletedOldApiCount++;

                if (oldProvider === "365scores") {
                    deleted365ScoresCount++;
                }

                continue;
            }

            // --------------------------------------
            // Legacy 365Scores records without provider
            // --------------------------------------

            if (
                providerSwitchDetected &&
                previousProvider === "365scores" &&
                is365ScoresFootballMatch(oldMatch)
            ) {
                updates[
                    MATCHES_PATH + "/" + matchId
                ] = null;

                deleted365ScoresCount++;
                deletedOldApiCount++;

                continue;
            }

            // Do not delete records with unknown provider.
            if (!oldProvider) {
                skippedUnknownProviderCount++;
            }
        }

        console.log(
            "Cleanup completed after all requests succeeded."
        );

    } else {
        console.log(
            "Cleanup skipped: empty fixture list or " +
            "incomplete API fetch."
        );
    }

    // ----------------------------------------------
    // Provider marker
    // ----------------------------------------------

    if (safeToCleanup) {
        updates[PROVIDER_STATE_PATH] =
            CURRENT_PROVIDER;
    }

    // ----------------------------------------------
    // Save changes atomically
    // ----------------------------------------------

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    } else {
        console.log("No Firebase changes to save.");
    }

    // ----------------------------------------------
    // SUMMARY
    // ----------------------------------------------

    console.log("==================================");
    console.log("SportsHub API-Football Sync Completed");
    console.log("==================================");

    console.log(
        "Successful requests:",
        successfulRequests
    );

    console.log(
        "Failed requests:",
        failedRequests
    );

    console.log(
        "Fixtures received:",
        discoveredFixtures.length
    );

    console.log(
        "Unique fixtures:",
        uniqueFixtures.length
    );

    console.log(
        "Competitions processed:",
        Object.keys(competitionUpdates).length
    );

    console.log(
        "Selected competitions:",
        selectedCompetitionIds.size
    );

    console.log(
        "New competitions:",
        newCompetitionCount
    );

    console.log(
        "Selected matches synced:",
        selectedMatchCount
    );

    console.log(
        "Old API matches deleted:",
        deletedOldApiCount
    );

    console.log(
        "Old 365Scores matches deleted:",
        deleted365ScoresCount
    );

    console.log(
        "Out-of-date API-Football matches deleted:",
        deletedOutOfDateCount
    );

    console.log(
        "Unselected competition matches deleted:",
        deletedUnselectedCount
    );

    console.log(
        "Unknown provider records preserved:",
        skippedUnknownProviderCount
    );

    console.log(
        "Provider marker:",
        safeToCleanup
            ? CURRENT_PROVIDER
            : "unchanged"
    );

    console.log("==================================");
}

// ==================================================
// RUN
// ==================================================

main()
    .then(async function() {
        if (admin.apps.length > 0) {
            await admin.app().delete();
        }

        process.exit(0);
    })
    .catch(async function(error) {
        console.error(
            "API-Football sync failed:",
            error.stack || error.message
        );

        if (admin.apps.length > 0) {
            try {
                await admin.app().delete();
            } catch (e) {
                console.error(e.message);
            }
        }

        process.exit(1);
    });

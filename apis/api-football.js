"use strict";

const admin = require("firebase-admin");
const axios = require("axios");

const DEFAULT_API_URL =
    "https://v3.football.api-sports.io/fixtures";

const TIME_ZONE = "Asia/Kolkata";
const REQUEST_TIMEOUT = 30000;
const REQUEST_DELAY = 500;

const API_KEY = process.env.API_FOOTBALL_KEY || "";

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
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseURL
    });

    return admin.database();
}

// ==================================================
// DATE HELPERS
// ==================================================

function getDateOffset(days) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const values = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }

    const date = new Date(Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day) + days,
        12,
        0,
        0
    ));

    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0")
    ].join("-");
}

function formatMatchDate(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (isNaN(date.getTime())) {
        return "";
    }

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(date);

    const values = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }

    return values.day + "-" +
        values.month + "-" +
        values.year;
}

function formatMatchTime(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).format(date);
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

    const response = await axios.get(DEFAULT_API_URL, {
        params: {
            date: date,
            timezone: TIME_ZONE
        },
        headers: {
            "x-apisports-key": API_KEY,
            "Accept": "application/json"
        },
        timeout: REQUEST_TIMEOUT
    });

    const data = response.data;

    if (
        data &&
        data.errors &&
        (
            Array.isArray(data.errors)
                ? data.errors.length > 0
                : Object.keys(data.errors).length > 0
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
        item.fixture && item.fixture.status
            ? item.fixture.status
            : {};

    const code = String(status.short || "NS")
        .toUpperCase();

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

    if ([
        "1H",
        "2H",
        "3H",
        "4H",
        "5H",
        "LIVE"
    ].indexOf(code) !== -1) {
        return {
            status: "Live",
            shortStatus: elapsed == null
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
        "awayLogo"
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

    const match = Object.assign({}, preserved, {
        gameId: fixtureId,
        fixtureId: fixtureId,
        apiFixtureId: fixtureId,

        apiProvider: "apifootball",

        competitionId:
            league.id == null
                ? null
                : Number(league.id),

        league:
            league.name || "Unknown Competition",

        competition:
            league.name || "Unknown Competition",

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

        date: formatMatchDate(fixture.date),
        time: formatMatchTime(fixture.date),

        timestamp: Math.floor(timestamp / 1000),
        matchTimeMillis: timestamp,

        lastUpdated: Date.now()
    });

    // Use API stadium only when no admin value exists.
    if (!match.stadium) {
        match.stadium =
            fixture.venue && fixture.venue.name
                ? fixture.venue.name
                : "";
    }

    // Use API logos only when there are no existing values.
    if (!match.homeLogo) {
        match.homeLogo = home.logo || "";
    }

    if (!match.awayLogo) {
        match.awayLogo = away.logo || "";
    }

    return match;
}

// ==================================================
// DETECT OLD 365SCORES FOOTBALL MATCHES
// ==================================================

function is365ScoresFootballMatch(match) {
    if (
        !match ||
        typeof match !== "object"
    ) {
        return false;
    }

    /*
     * Only consider football records.
     *
     * Do not delete basketball or records whose sport
     * cannot be safely identified.
     */

    const sportId = String(
        match.sportId == null
            ? ""
            : match.sportId
    );

    if (sportId !== "1") {
        return false;
    }

    const provider = String(
        match.apiProvider || ""
    ).trim().toLowerCase();

    // Explicit provider identification.
    if (
        provider === "365scores" ||
        provider === "365"
    ) {
        return true;
    }

    /*
     * Legacy records may not have apiProvider.
     *
     * Require BOTH a known 365Scores logo URL
     * and both competitor IDs.
     *
     * Missing apiProvider alone is NOT enough.
     */

    const homeLogo = String(
        match.homeLogo || ""
    ).toLowerCase();

    const awayLogo = String(
        match.awayLogo || ""
    ).toLowerCase();

    const has365ScoresLogo =
        homeLogo.includes(
            "imagecache.365scores.com"
        ) ||
        awayLogo.includes(
            "imagecache.365scores.com"
        );

    const has365ScoresCompetitors =
        match.homeCompetitorId != null &&
        match.awayCompetitorId != null;

    return (
        has365ScoresLogo &&
        has365ScoresCompetitors
    );
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
    // Read parser settings
    // ----------------------------------------------

    const settingsSnapshot =
        await db.ref("settings").once("value");

    const settings =
        settingsSnapshot.val() || {};

    const selectedParser =
        String(
            settings.selected_parser || "parse1"
        );

    const parserConfig =
        settings.parse &&
        settings.parse[selectedParser]
            ? settings.parse[selectedParser]
            : {};

    const apiParser =
        String(
            parserConfig.api_parser || ""
        ).trim().toLowerCase();

    if (
        apiParser &&
        [
            "apifootball",
            "api-football",
            "football"
        ].indexOf(apiParser) === -1
    ) {
        throw new Error(
            "Selected parser is not API-Football: " +
            apiParser
        );
    }

    console.log(
        "Selected parser:",
        selectedParser
    );

    console.log(
        "API provider:",
        apiParser || "apifootball"
    );

    // ----------------------------------------------
    // Read existing Firebase data
    // ----------------------------------------------

    const results = await Promise.all([
        db.ref("competition_selection").once("value"),
        db.ref("competitions").once("value"),
        db.ref("matches").once("value")
    ]);

    const competitionSelection =
        results[0].val() || {};

    const existingCompetitions =
        results[1].val() || {};

    const existingMatches =
        results[2].val() || {};

    // ----------------------------------------------
    // Fetch yesterday, today and tomorrow
    // ----------------------------------------------

    const discoveredFixtures = [];

    let successfulRequests = 0;
    let failedRequests = 0;

    for (const offset of [-1, 0, 1]) {
        const date = getDateOffset(offset);

        try {
            const fixtures =
                await fetchFixtures(date);

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
                    ? JSON.stringify(
                        error.response.data
                    )
                    : error.message
            );
        }

        await new Promise(function (resolve) {
            setTimeout(
                resolve,
                REQUEST_DELAY
            );
        });
    }

    if (successfulRequests === 0) {
        throw new Error(
            "All API requests failed. " +
            "Firebase data was not changed."
        );
    }

    console.log(
        "Total fixtures received:",
        discoveredFixtures.length
    );

    console.log(
        "Successful requests:",
        successfulRequests
    );

    console.log(
        "Failed requests:",
        failedRequests
    );

    // ----------------------------------------------
    // Prepare Firebase updates
    // ----------------------------------------------

    const competitionUpdates = {};
    const selectionUpdates = {};
    const matchUpdates = {};

    const seenFixtures = new Set();

    let newCompetitionCount = 0;
    let selectedMatchCount = 0;

    // ----------------------------------------------
    // Process fixtures
    // ----------------------------------------------

    for (const item of discoveredFixtures) {
        const league = item.league || {};

        const competitionId =
            Number(league.id);

        if (
            !Number.isInteger(competitionId) ||
            competitionId <= 0
        ) {
            continue;
        }

        const competitionKey =
            String(competitionId);

        const oldCompetition =
            existingCompetitions[
                competitionKey
            ] || {};

        const hasSelection =
            Object.prototype.hasOwnProperty.call(
                competitionSelection,
                competitionKey
            );

        const selected =
            isCompetitionSelected(
                hasSelection
                    ? competitionSelection[
                        competitionKey
                    ]
                    : undefined,
                oldCompetition
            );

        const competitionName =
            league.name ||
            "Unknown Competition";

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

        // Initialize only missing selection values.
        if (!hasSelection) {
            selectionUpdates[competitionKey] =
                selected;
        }

        // Sync matches only for selected competitions.
        if (!selected) {
            continue;
        }

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

        const fixtureKey =
            String(fixtureId);

        if (seenFixtures.has(fixtureKey)) {
            continue;
        }

        seenFixtures.add(fixtureKey);

        const oldMatch =
            existingMatches[fixtureKey] || {};

        const match =
            convertFixture(
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
    // Build Firebase multi-location update
    // ----------------------------------------------

    const updates = {};

    for (
        const key of Object.keys(
            competitionUpdates
        )
    ) {
        updates[
            "competitions/" + key
        ] = competitionUpdates[key];
    }

    for (
        const key of Object.keys(
            selectionUpdates
        )
    ) {
        updates[
            "competition_selection/" + key
        ] = selectionUpdates[key];
    }

    for (
        const key of Object.keys(
            matchUpdates
        )
    ) {
        updates[
            "matches/" + key
        ] = matchUpdates[key];
    }

    // ----------------------------------------------
    // SAFE OLD 365SCORES CLEANUP
    // ----------------------------------------------

    let removed365ScoresCount = 0;

    /*
     * Do not delete legacy records if:
     *
     * 1. Any date request failed.
     * 2. The API returned no fixtures.
     * 3. No selected API-Football match was synced.
     *
     * This reduces the chance of deleting old data
     * when API access or configuration is broken.
     */

    const canCleanup365Scores =
        successfulRequests === 3 &&
        failedRequests === 0 &&
        discoveredFixtures.length > 0 &&
        selectedMatchCount > 0;

    if (canCleanup365Scores) {
        console.log(
            "Checking old 365Scores football matches..."
        );

        for (
            const matchId of Object.keys(
                existingMatches
            )
        ) {
            const oldMatch =
                existingMatches[matchId];

            if (
                !is365ScoresFootballMatch(
                    oldMatch
                )
            ) {
                continue;
            }

            /*
             * Never delete a match that is being
             * refreshed by API-Football in this run.
             */

            if (
                Object.prototype.hasOwnProperty.call(
                    matchUpdates,
                    matchId
                )
            ) {
                console.log(
                    "Keeping refreshed API-Football match:",
                    matchId
                );

                continue;
            }

            updates[
                "matches/" + matchId
            ] = null;

            removed365ScoresCount++;

            console.log(
                "Scheduled old 365Scores football match for removal:",
                matchId,
                oldMatch.home || "",
                "vs",
                oldMatch.away || ""
            );
        }

    } else {
        console.log(
            "365Scores cleanup skipped for safety."
        );

        console.log(
            "Cleanup requires all 3 requests to succeed, " +
            "fixtures to be received, and selected matches " +
            "to be synced."
        );
    }

    // ----------------------------------------------
    // Commit Firebase updates
    // ----------------------------------------------

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    }

    // ----------------------------------------------
    // SUMMARY
    // ----------------------------------------------

    console.log("==================================");
    console.log("API-Football Sync Completed");
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
        "Competitions processed:",
        Object.keys(
            competitionUpdates
        ).length
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
        "Old 365Scores football matches removed:",
        removed365ScoresCount
    );

    console.log("==================================");
}

// ==================================================
// RUN
// ==================================================

main()
    .then(async function () {
        if (admin.apps.length > 0) {
            await admin.app().delete();
        }

        process.exit(0);
    })
    .catch(async function (error) {
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

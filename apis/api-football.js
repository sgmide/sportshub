"use strict";

const admin = require("firebase-admin");
const axios = require("axios");

// ==================================================
// CONSTANTS
// ==================================================

const DEFAULT_API_URL =
    "https://v3.football.api-sports.io/fixtures";

const TIME_ZONE = "Asia/Kolkata";

const REQUEST_TIMEOUT = 30000;
const REQUEST_DELAY = 500;

const API_KEY =
    process.env.API_FOOTBALL_KEY || "";

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

    const now = new Date();

    const parts =
        new Intl.DateTimeFormat("en-GB", {
            timeZone: TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(now);

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

function formatMatchDate(dateValue) {

    if (!dateValue) {
        return "";
    }

    const date = new Date(dateValue);

    if (isNaN(date.getTime())) {
        return "";
    }

    const parts =
        new Intl.DateTimeFormat("en-GB", {
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

function formatMatchTime(dateValue) {

    if (!dateValue) {
        return "";
    }

    const date = new Date(dateValue);

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

    console.log("Fetching API-Football:", date);

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

    if (data && Array.isArray(data.errors)) {
        if (data.errors.length > 0) {
            throw new Error(
                JSON.stringify(data.errors)
            );
        }
    }

    if (data && data.errors &&
        typeof data.errors === "object" &&
        !Array.isArray(data.errors) &&
        Object.keys(data.errors).length > 0) {

        throw new Error(
            JSON.stringify(data.errors)
        );
    }

    if (!data || !Array.isArray(data.response)) {
        throw new Error(
            "Invalid API-Football response"
        );
    }

    console.log(
        "Fixtures received:",
        data.response.length
    );

    return data.response;
}

// ==================================================
// MATCH STATUS
// ==================================================

function getMatchStatus(fixture) {

    const status =
        fixture.fixture &&
        fixture.fixture.status
            ? fixture.fixture.status
            : {};

    const code =
        String(status.short || "NS").toUpperCase();

    const elapsed =
        status.elapsed == null
            ? null
            : status.elapsed;

    if (code === "PST") {
        return {
            status: "Postponed",
            shortStatus: "PPD",
            elapsed: elapsed
        };
    }

    if (code === "CANC") {
        return {
            status: "Cancelled",
            shortStatus: "CANC",
            elapsed: elapsed
        };
    }

    if (code === "ABD") {
        return {
            status: "Abandoned",
            shortStatus: "ABD",
            elapsed: elapsed
        };
    }

    if (code === "AWD") {
        return {
            status: "Awarded",
            shortStatus: "AWD",
            elapsed: elapsed
        };
    }

    if (code === "WO") {
        return {
            status: "Walkover",
            shortStatus: "WO",
            elapsed: elapsed
        };
    }

    if (code === "PEN") {
        return {
            status: "After Penalties",
            shortStatus: "AP",
            elapsed: elapsed
        };
    }

    if (code === "AET") {
        return {
            status: "After Extra Time",
            shortStatus: "AET",
            elapsed: elapsed
        };
    }

    if (code === "HT") {
        return {
            status: "Half Time",
            shortStatus: "HT",
            elapsed: elapsed
        };
    }

    if (code === "ET") {
        return {
            status: "Extra Time",
            shortStatus: "ET",
            elapsed: elapsed
        };
    }

    if (code === "BT") {
        return {
            status: "Break Time",
            shortStatus: "BT",
            elapsed: elapsed
        };
    }

    if (code === "LIVE" ||
        code === "1H" ||
        code === "2H" ||
        code === "3H" ||
        code === "4H" ||
        code === "5H" ||
        code === "INT" ||
        code === "SUSP") {

        return {
            status: "Live",
            shortStatus:
                elapsed == null
                    ? code
                    : String(elapsed) + "'",
            elapsed: elapsed
        };
    }

    if (code === "FT") {
        return {
            status: "Finished",
            shortStatus: "FT",
            elapsed: elapsed
        };
    }

    if (code === "NS" ||
        code === "TBD") {

        return {
            status: "Upcoming",
            shortStatus: "NS",
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

    if (!Number.isInteger(fixtureId) ||
        fixtureId <= 0) {
        return null;
    }

    const timestamp = Date.parse(fixture.date);

    if (!Number.isFinite(timestamp)) {
        return null;
    }

    const homeScore =
        goals.home == null ? "" : goals.home;

    const awayScore =
        goals.away == null ? "" : goals.away;

    const matchStatus =
        getMatchStatus(item);

    const previous = oldMatch || {};

    const streamUrl =
        typeof previous.streamUrl === "string"
            ? previous.streamUrl
            : "";

    // Preserve admin-created fields.
    const protectedFields = [
        "streamUrl",
        "goalEvents",
        "adminNotes"
    ];

    const preserved = {};

    for (const key of protectedFields) {
        if (Object.prototype.hasOwnProperty.call(
            previous,
            key
        )) {
            preserved[key] = previous[key];
        }
    }

    return Object.assign(
        {},
        preserved,
        {
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

            country:
                league.country || "",

            season:
                league.season || null,

            sportId: 1,

            home:
                home.name || "Home",

            away:
                away.name || "Away",

            homeLogo:
                home.logo || "",

            awayLogo:
                away.logo || "",

            homeTeamId:
                home.id == null ? 0 : Number(home.id),

            awayTeamId:
                away.id == null ? 0 : Number(away.id),

            homeScore: homeScore,

            awayScore: awayScore,

            score:
                homeScore !== "" &&
                awayScore !== ""
                    ? homeScore + " - " + awayScore
                    : "VS",

            status:
                matchStatus.status,

            shortStatus:
                matchStatus.shortStatus,

            elapsed:
                matchStatus.elapsed,

            date:
                formatMatchDate(fixture.date),

            time:
                formatMatchTime(fixture.date),

            timestamp:
                Math.floor(timestamp / 1000),

            matchTimeMillis:
                timestamp,

            stadium:
                fixture.venue &&
                fixture.venue.name
                    ? fixture.venue.name
                    : "",

            streamUrl:
                streamUrl,

            lastUpdated:
                Date.now()
        }
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

    // ----------------------------------------------
    // READ SETTINGS
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

    if (apiParser &&
        apiParser !== "apifootball" &&
        apiParser !== "api-football" &&
        apiParser !== "football") {

        throw new Error(
            "Selected parser is not API-Football: " +
            apiParser
        );
    }

    console.log("Selected parser:", selectedParser);
    console.log("API provider:", apiParser || "apifootball");

    // ----------------------------------------------
    // READ FIREBASE DATA
    // ----------------------------------------------

    const selectionSnapshot =
        await db.ref("competition_selection")
            .once("value");

    const competitionSelection =
        selectionSnapshot.val() || {};

    const competitionsSnapshot =
        await db.ref("competitions")
            .once("value");

    const existingCompetitions =
        competitionsSnapshot.val() || {};

    const matchesSnapshot =
        await db.ref("matches")
            .once("value");

    const existingMatches =
        matchesSnapshot.val() || {};

    // ----------------------------------------------
    // FETCH YESTERDAY, TODAY, TOMORROW
    // ----------------------------------------------

    const discoveredFixtures = [];

    let successfulRequests = 0;

    for (const offset of [-1, 0, 1]) {

        const date = getDateOffset(offset);

        try {

            const fixtures =
                await fetchFixtures(date);

            discoveredFixtures.push(...fixtures);

            successfulRequests++;

        } catch (error) {

            console.error(
                "Fixture request failed:",
                date,
                error.response &&
                error.response.data
                    ? JSON.stringify(error.response.data)
                    : error.message
            );
        }

        await new Promise(resolve =>
            setTimeout(resolve, REQUEST_DELAY)
        );
    }

    if (successfulRequests === 0) {
        throw new Error(
            "All API-Football requests failed. " +
            "Existing Firebase data was not changed."
        );
    }

    console.log(
        "Total fixtures received:",
        discoveredFixtures.length
    );

    // ----------------------------------------------
    // PREPARE UPDATES
    // ----------------------------------------------

    const competitionUpdates = {};
    const selectionUpdates = {};
    const matchUpdates = {};

    const seenFixtures = new Set();

    let newCompetitionCount = 0;
    let selectedMatchCount = 0;

    for (const item of discoveredFixtures) {

        const league = item.league || {};
        const competitionId = Number(league.id);

        if (!Number.isInteger(competitionId) ||
            competitionId <= 0) {
            continue;
        }

        const competitionKey =
            String(competitionId);

        const competitionName =
            league.name || "Unknown Competition";

        const sportId = 1;

        const oldCompetition =
            existingCompetitions[competitionKey] || {};

        // ------------------------------------------
        // PRESERVE COMPETITION SELECTION
        // ------------------------------------------

        let selected = false;

        if (Object.prototype.hasOwnProperty.call(
            competitionSelection,
            competitionKey
        )) {

            const value =
                competitionSelection[competitionKey];

            selected =
                value === true ||
                (
                    value &&
                    typeof value === "object" &&
                    value.selected === true
                );

        } else {

            selected =
                oldCompetition.selected === true;

            selectionUpdates[competitionKey] =
                selected;
        }

        competitionUpdates[competitionKey] = {
            id: competitionId,
            name: competitionName,
            sportId: sportId,
            selected: selected,
            country: league.country || "",
            season: league.season || null
        };

        if (!oldCompetition.id) {
            newCompetitionCount++;
        }

        // ------------------------------------------
        // SYNC SELECTED COMPETITIONS ONLY
        // ------------------------------------------

        if (!selected) {
            continue;
        }

        const fixtureId = Number(
            item.fixture && item.fixture.id
        );

        if (!Number.isInteger(fixtureId) ||
            fixtureId <= 0) {
            continue;
        }

        const fixtureKey = String(fixtureId);

        if (seenFixtures.has(fixtureKey)) {
            continue;
        }

        seenFixtures.add(fixtureKey);

        const oldMatch =
            existingMatches[fixtureKey] || {};

        const match =
            convertFixture(item, oldMatch);

        if (!match) {
            continue;
        }

        matchUpdates[fixtureKey] = match;

        selectedMatchCount++;
    }

    // ----------------------------------------------
    // WRITE COMPETITIONS
    // ----------------------------------------------

    if (Object.keys(competitionUpdates).length > 0) {

        await db.ref("competitions")
            .update(competitionUpdates);
    }

    // ----------------------------------------------
    // INITIALIZE SELECTION FLAGS
    // ----------------------------------------------

    if (Object.keys(selectionUpdates).length > 0) {

        await db.ref("competition_selection")
            .update(selectionUpdates);
    }

    // ----------------------------------------------
    // WRITE MATCHES
    // ----------------------------------------------

    if (Object.keys(matchUpdates).length > 0) {

        await db.ref("matches")
            .update(matchUpdates);
    }

    console.log("==================================");
    console.log("API-Football Sync Completed");
    console.log("Successful requests:", successfulRequests);
    console.log("Fixtures received:", discoveredFixtures.length);
    console.log(
        "Competitions processed:",
        Object.keys(competitionUpdates).length
    );
    console.log("New competitions:", newCompetitionCount);
    console.log("Selected matches synced:", selectedMatchCount);
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

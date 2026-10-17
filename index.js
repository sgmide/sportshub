const axios = require("axios");
const admin = require("firebase-admin");

const API_KEY = process.env.API_FOOTBALL_KEY;
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!API_KEY || !DATABASE_URL || !SERVICE_ACCOUNT_JSON) {
    console.error("Missing required GitHub Secrets.");
    process.exit(1);
}

let serviceAccount;

try {
    serviceAccount = JSON.parse(SERVICE_ACCOUNT_JSON);
} catch (error) {
    console.error("FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
});

const db = admin.database();

const api = axios.create({
    baseURL: "https://v3.football.api-sports.io",
    timeout: 30000,
    headers: {
        "x-apisports-key": API_KEY
    }
});

function formatDate(dateString) {
    if (!dateString) return "";

    const date = new Date(dateString);

    if (isNaN(date.getTime())) return "";

    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Asia/Kolkata"
    });
}

function formatTime(dateString) {
    if (!dateString) return "";

    const date = new Date(dateString);

    if (isNaN(date.getTime())) return "";

    return date.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Kolkata"
    });
}

function getStatus(shortStatus, longStatus) {
    const status = String(shortStatus || "").toUpperCase();

    if (["1H", "2H", "ET", "BT", "P", "LIVE"].includes(status)) {
        return "Live";
    }

    if (status === "HT") return "HT";
    if (status === "FT") return "FT";
    if (status === "AET") return "After Extra Time";
    if (status === "PEN") return "After Penalties";
    if (status === "PST") return "Postponed";
    if (status === "CANC") return "Cancelled";
    if (status === "ABD") return "Abandoned";
    if (status === "SUSP") return "Suspended";
    if (status === "INT") return "Interrupted";
    if (status === "NS") return "Upcoming";

    return longStatus || status || "Upcoming";
}

function convertFixture(item) {
    const fixture = item.fixture || {};
    const league = item.league || {};
    const teams = item.teams || {};
    const goals = item.goals || {};
    const status = fixture.status || {};

    const fixtureId = String(fixture.id || "");

    return {
        gameId: fixtureId,
        fixtureId: fixtureId,

        competitionId: String(league.id || ""),
        competition: String(league.name || ""),
        league: String(league.name || ""),
        country: String(league.country || ""),
        season: String(league.season || ""),

        home: String((teams.home || {}).name || ""),
        away: String((teams.away || {}).name || ""),

        homeLogo: String((teams.home || {}).logo || ""),
        awayLogo: String((teams.away || {}).logo || ""),

        date: formatDate(fixture.date),
        time: formatTime(fixture.date),
        timestamp: Number(fixture.timestamp || 0),

        homeScore: goals.home == null ? 0 : goals.home,
        awayScore: goals.away == null ? 0 : goals.away,
        score: (goals.home == null ? 0 : goals.home) +
            " - " +
            (goals.away == null ? 0 : goals.away),

        status: getStatus(status.short, status.long),
        shortStatus: String(status.short || "NS"),
        elapsed: status.elapsed == null ? 0 : status.elapsed,

        stadium: String(
            ((fixture.venue || {}).name) || ""
        ),

        lastUpdated: Date.now()
    };
}

async function fetchFixturesForDate(date) {
    console.log("Fetching fixtures for:", date);

    const response = await api.get("/fixtures", {
        params: {
            date: date,
            timezone: "Asia/Kolkata"
        }
    });

    const data = response.data || {};

    if (data.errors && Object.keys(data.errors).length > 0) {
        throw new Error(
            "API-Football error: " + JSON.stringify(data.errors)
        );
    }

    return data.response || [];
}

async function fetchSelectedFixture(fixtureId) {
    const response = await api.get("/fixtures", {
        params: {
            id: fixtureId,
            timezone: "Asia/Kolkata"
        }
    });

    const data = response.data || {};

    if (data.errors && Object.keys(data.errors).length > 0) {
        throw new Error(
            "Fixture " + fixtureId + ": " +
            JSON.stringify(data.errors)
        );
    }

    const fixtures = data.response || [];

    if (fixtures.length === 0) {
        return null;
    }

    return convertFixture(fixtures[0]);
}

async function syncAvailableMatches() {
    const now = new Date();

    const dates = [];

    for (let offset = -1; offset <= 2; offset++) {
        const date = new Date(now.getTime() + offset * 86400000);

        dates.push(
            date.toLocaleDateString("en-CA", {
                timeZone: "Asia/Kolkata"
            })
        );
    }

    const uniqueDates = Array.from(new Set(dates));
    const available = {};

    for (const date of uniqueDates) {
        const fixtures = await fetchFixturesForDate(date);

        for (const item of fixtures) {
            const match = convertFixture(item);

            if (match.gameId) {
                available[match.gameId] = match;
            }
        }
    }

    await db.ref("availableMatches").update(available);

    console.log(
        "Available matches fetched:",
        Object.keys(available).length
    );
}

async function syncSelectedMatches() {
    const snapshot = await db.ref("selectedFixtures").once("value");
    const selections = snapshot.val() || {};

    const selectedIds = Object.keys(selections).filter(function(id) {
        const value = selections[id];

        if (value === true) return true;
        if (value && value.selected === true) return true;

        return false;
    });

    console.log("Selected fixture count:", selectedIds.length);

    for (const fixtureId of selectedIds) {
        try {
            const match = await fetchSelectedFixture(fixtureId);

            if (!match) {
                console.log("Fixture not found:", fixtureId);
                continue;
            }

            await db.ref("matches/" + fixtureId).update(match);

            console.log(
                "Updated selected match:",
                match.home,
                "vs",
                match.away
            );
        } catch (error) {
            console.error(
                "Failed to update fixture " + fixtureId + ":",
                error.message
            );
        }
    }
}

async function main() {
    console.log("SportsHub sync started.");

    await syncAvailableMatches();
    await syncSelectedMatches();

    console.log("SportsHub sync completed.");
}

main()
    .then(function() {
        process.exit(0);
    })
    .catch(function(error) {
        console.error("SportsHub sync failed:", error.message);
        process.exit(1);
    });

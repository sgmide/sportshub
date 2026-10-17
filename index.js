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

const TIMEZONE = "Asia/Kolkata";

/*
 * API-FOOTBALL FREE PLAN:
 * ഈ ഉദാഹരണത്തിൽ കഴിഞ്ഞ ദിവസം, ഇന്ന്, നാളെ
 * എന്നീ തീയതികൾ മാത്രമാണ് പരിശോധിക്കുന്നത്.
 *
 * API error വന്നാൽ മറ്റ് തീയതികളുടെ request തുടരും.
 */

function getLocalDate(offset) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const values = {};

    for (const part of parts) {
        values[part.type] = part.value;
    }

    const date = new Date(
        Date.UTC(
            Number(values.year),
            Number(values.month) - 1,
            Number(values.day) + offset
        )
    );

    return date.toISOString().substring(0, 10);
}

function formatDate(dateString) {
    if (!dateString) return "";

    const date = new Date(dateString);

    if (isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: TIMEZONE
    }).format(date);
}

function formatTime(dateString) {
    if (!dateString) return "";

    const date = new Date(dateString);

    if (isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: TIMEZONE
    }).format(date);
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
    const venue = fixture.venue || {};

    const fixtureId = String(fixture.id || "");

    const homeScore = goals.home == null ? 0 : goals.home;
    const awayScore = goals.away == null ? 0 : goals.away;

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

        homeScore: homeScore,
        awayScore: awayScore,
        score: homeScore + " - " + awayScore,

        status: getStatus(status.short, status.long),
        shortStatus: String(status.short || "NS"),
        elapsed: status.elapsed == null ? 0 : status.elapsed,

        stadium: String(venue.name || ""),

        lastUpdated: Date.now()
    };
}

async function fetchFixturesForDate(date) {
    console.log("Fetching fixtures for:", date);

    const response = await api.get("/fixtures", {
        params: {
            date: date,
            timezone: TIMEZONE
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
            timezone: TIMEZONE
        }
    });

    const data = response.data || {};

    if (data.errors && Object.keys(data.errors).length > 0) {
        throw new Error(
            "API-Football error: " + JSON.stringify(data.errors)
        );
    }

    const fixtures = data.response || [];

    if (fixtures.length === 0) {
        return null;
    }

    return convertFixture(fixtures[0]);
}

/*
 * AVAILABLE MATCHES
 *
 * API-Football-ൽ ലഭ്യമായ മത്സരങ്ങൾ Firebase-ൽ സൂക്ഷിക്കുന്നു.
 * ഒരു തീയതിയുടെ request പരാജയപ്പെട്ടാലും അടുത്ത തീയതി പരിശോധിക്കും.
 */

async function syncAvailableMatches() {
    const dates = [
        getLocalDate(-1),
        getLocalDate(0),
        getLocalDate(1)
    ];

    const uniqueDates = Array.from(new Set(dates));

    const available = {};
    let successfulDates = 0;

    for (const date of uniqueDates) {
        try {
            const fixtures = await fetchFixturesForDate(date);

            successfulDates++;

            console.log(
                "Fixtures received for " + date + ": " +
                fixtures.length
            );

            for (const item of fixtures) {
                const match = convertFixture(item);

                if (match.gameId) {
                    available[match.gameId] = match;
                }
            }
        } catch (error) {
            console.error(
                "Could not fetch " + date + ": " + error.message
            );
        }
    }

    /*
     * എല്ലാ തീയതികളുടെയും request പരാജയപ്പെട്ടാൽ
     * നിലവിലുള്ള Firebase data മാറ്റരുത്.
     */

    if (successfulDates === 0) {
        console.error(
            "No dates were fetched successfully. " +
            "Existing availableMatches data was preserved."
        );

        return;
    }

    /*
     * update() ഉപയോഗിക്കുന്നതിനാൽ പഴയ മത്സരങ്ങൾ delete ആകില്ല.
     */

    if (Object.keys(available).length > 0) {
        await db.ref("availableMatches").update(available);
    }

    console.log(
        "Available matches fetched:",
        Object.keys(available).length
    );

    console.log(
        "Successfully fetched dates:",
        successfulDates,
        "/",
        uniqueDates.length
    );
}

/*
 * SELECTED MATCHES
 *
 * selectedFixtures/{fixtureId} = true
 * അല്ലെങ്കിൽ
 * selectedFixtures/{fixtureId}/selected = true
 *
 * എന്ന രീതിയിൽ Admin തിരഞ്ഞെടുക്കുന്ന മത്സരങ്ങൾ മാത്രമാണ്
 * matches-ൽ പുതുക്കുന്നത്.
 */

async function syncSelectedMatches() {
    const snapshot = await db.ref("selectedFixtures").once("value");
    const selections = snapshot.val() || {};

    const selectedIds = Object.keys(selections).filter(function(id) {
        const value = selections[id];

        if (value === true) {
            return true;
        }

        if (value && value.selected === true) {
            return true;
        }

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
                match.away,
                "|",
                match.score,
                "|",
                match.status
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
    console.log("================================");
    console.log("SportsHub sync started.");
    console.log("================================");

    await syncAvailableMatches();

    await syncSelectedMatches();

    console.log("================================");
    console.log("SportsHub sync completed.");
    console.log("================================");
}

main()
    .then(function() {
        process.exit(0);
    })
    .catch(function(error) {
        console.error(
            "SportsHub sync failed:",
            error.message
        );

        process.exit(1);
    });

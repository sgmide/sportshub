const axios = require("axios");
const admin = require("firebase-admin");

const API_PROVIDER = (
    process.env.API_PROVIDER || "apifootball"
).toLowerCase();

const API_KEY = process.env.API_FOOTBALL_KEY;
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT;

const TIMEZONE = "Asia/Kolkata";

if (!API_KEY || !DATABASE_URL || !SERVICE_ACCOUNT_JSON) {
    console.error("Missing required GitHub Secrets.");
    process.exit(1);
}

let serviceAccount;

try {
    serviceAccount = JSON.parse(SERVICE_ACCOUNT_JSON);
} catch (error) {
    console.error("FIREBASE_SERVICE_ACCOUNT is invalid JSON.");
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
});

const db = admin.database();

/*
 * API PROVIDER
 *
 * ഇപ്പോൾ API-Football.
 * മറ്റൊരു API ചേർക്കുമ്പോൾ ഈ ഭാഗം വിപുലീകരിക്കാം.
 */

function createProvider() {

    if (API_PROVIDER === "apifootball") {

        return axios.create({
            baseURL: "https://v3.football.api-sports.io",
            timeout: 30000,
            headers: {
                "x-apisports-key": API_KEY
            }
        });
    }

    throw new Error(
        "Unsupported API_PROVIDER: " + API_PROVIDER
    );
}

const api = createProvider();

/*
 * തീയതി: ഇന്ത്യയിലെ local date
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

    const date = new Date(Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day) + offset
    ));

    return date.toISOString().substring(0, 10);
}

function formatDate(dateString) {

    if (!dateString) {
        return "";
    }

    const date = new Date(dateString);

    if (isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: TIMEZONE
    }).format(date).replace(/\//g, "-");
}

function formatTime(dateString) {

    if (!dateString) {
        return "";
    }

    const date = new Date(dateString);

    if (isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: TIMEZONE
    }).format(date);
}

function getStatus(shortStatus, longStatus) {

    const status = String(
        shortStatus || ""
    ).toUpperCase();

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

/*
 * API RESPONSE -> COMMON MATCH FORMAT
 *
 * Firebase-ൽ നിലവിലുള്ള field names നിലനിർത്തുന്നു.
 */

function convertFixture(item) {

    const fixture = item.fixture || {};
    const league = item.league || {};
    const teams = item.teams || {};
    const goals = item.goals || {};
    const status = fixture.status || {};
    const venue = fixture.venue || {};

    const fixtureId = String(fixture.id || "");

    if (!fixtureId) {
        return null;
    }

    const homeScore =
        goals.home == null ? 0 : goals.home;

    const awayScore =
        goals.away == null ? 0 : goals.away;

    const fixtureDate = fixture.date || "";

    const timestamp = Number(
        fixture.timestamp || 0
    );

    return {

        gameId: Number(fixtureId),

        fixtureId: fixtureId,

        apiProvider: API_PROVIDER,

        apiFixtureId: fixtureId,

        competitionId: Number(league.id || 0),

        league: String(league.name || ""),

        home: String(
            (teams.home || {}).name || ""
        ),

        away: String(
            (teams.away || {}).name || ""
        ),

        homeLogo: String(
            (teams.home || {}).logo || ""
        ),

        awayLogo: String(
            (teams.away || {}).logo || ""
        ),

        date: formatDate(fixtureDate),

        time: formatTime(fixtureDate),

        timestamp: timestamp,

        matchTimeMillis: timestamp * 1000,

        homeScore: homeScore,

        awayScore: awayScore,

        score: homeScore + " - " + awayScore,

        status: getStatus(
            status.short,
            status.long
        ),

        shortStatus: String(
            status.short || "NS"
        ),

        stadium: String(venue.name || ""),

        lastUpdated: Date.now()
    };
}

/*
 * API-FOOTBALL: ഒരു തീയതിയിലെ മത്സരങ്ങൾ
 */

async function fetchFixturesForDate(date) {

    if (API_PROVIDER !== "apifootball") {
        throw new Error(
            "Provider adapter is not implemented: " +
            API_PROVIDER
        );
    }

    const response = await api.get("/fixtures", {
        params: {
            date: date,
            timezone: TIMEZONE
        }
    });

    const data = response.data || {};

    if (
        data.errors &&
        Object.keys(data.errors).length > 0
    ) {
        throw new Error(
            JSON.stringify(data.errors)
        );
    }

    return data.response || [];
}

/*
 * AVAILABLE MATCHES
 *
 * പഴയ Firebase data delete ചെയ്യില്ല.
 */

async function syncAvailableMatches() {

    const dates = [
        getLocalDate(-1),
        getLocalDate(0),
        getLocalDate(1)
    ];

    const available = {};

    let successfulDates = 0;

    for (const date of dates) {

        try {

            const fixtures =
                await fetchFixturesForDate(date);

            successfulDates++;

            console.log(
                "Fetched " + fixtures.length +
                " fixtures for " + date
            );

            for (const item of fixtures) {

                const match = convertFixture(item);

                if (match && match.fixtureId) {

                    available[match.fixtureId] = match;
                }
            }

        } catch (error) {

            console.error(
                "Failed date " + date + ":",
                error.message
            );
        }
    }

    if (successfulDates === 0) {

        throw new Error(
            "All fixture requests failed. " +
            "Existing Firebase data preserved."
        );
    }

    if (Object.keys(available).length === 0) {

        console.log(
            "No fixtures returned. Existing data preserved."
        );

        return;
    }

    /*
     * ഓരോ match-ഉം update ചെയ്യുന്നു.
     * Existing streamUrl overwrite ചെയ്യില്ല.
     */

    for (const fixtureId of Object.keys(available)) {

        const incoming = available[fixtureId];

        const ref = db.ref(
            "availableMatches/" + fixtureId
        );

        const snapshot = await ref.once("value");

        const existing = snapshot.val() || {};

        incoming.streamUrl =
            existing.streamUrl || "";

        await ref.update(incoming);
    }

    console.log(
        "Available matches updated:",
        Object.keys(available).length
    );
}

/*
 * SELECTED MATCHES
 *
 * selectedFixtures/{fixtureId} = true
 */

async function syncSelectedMatches() {

    const snapshot = await db
        .ref("selectedFixtures")
        .once("value");

    const selections = snapshot.val() || {};

    const selectedIds = Object.keys(
        selections
    ).filter(function(id) {

        const value = selections[id];

        return value === true ||
            (value && value.selected === true);
    });

    console.log(
        "Selected fixture count:",
        selectedIds.length
    );

    for (const fixtureId of selectedIds) {

        try {

            const fixtures =
                await fetchFixturesForDate(
                    getLocalDate(0)
                );

            let found = null;

            for (const item of fixtures) {

                if (
                    String(item.fixture.id) ===
                    String(fixtureId)
                ) {
                    found = item;
                    break;
                }
            }

            if (!found) {

                console.log(
                    "Selected fixture not found in today's list:",
                    fixtureId
                );

                continue;
            }

            const match = convertFixture(found);

            if (!match) {
                continue;
            }

            const ref = db.ref(
                "matches/" + fixtureId
            );

            const oldSnapshot = await ref.once("value");

            const existing = oldSnapshot.val() || {};

            /*
             * Admin നൽകിയ Stream URL നിലനിർത്തുക.
             */

            match.streamUrl =
                existing.streamUrl || "";

            /*
             * പഴയ compatibility field-ുകൾ സംരക്ഷിക്കുക.
             */

            match.gameId = Number(
                existing.gameId || match.gameId
            );

            await ref.update(match);

            console.log(
                "Updated:",
                match.home,
                "vs",
                match.away
            );

        } catch (error) {

            console.error(
                "Selected fixture failed:",
                fixtureId,
                error.message
            );
        }
    }
}

async function main() {

    console.log("SportsHub sync started.");
    console.log("Provider:", API_PROVIDER);

    await syncAvailableMatches();

    await syncSelectedMatches();

    console.log("SportsHub sync completed.");
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

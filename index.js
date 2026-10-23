const axios = require("axios");
const admin = require("firebase-admin");

/*
 * SPORTS HUB CONFIGURATION
 */

const API_PROVIDER = (
    process.env.API_PROVIDER || "apifootball"
).toLowerCase();

const API_KEY = process.env.API_FOOTBALL_KEY;
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const SERVICE_ACCOUNT_JSON =
    process.env.FIREBASE_SERVICE_ACCOUNT;

const TIMEZONE = "Asia/Kolkata";

/*
 * Validate GitHub Secrets
 */

if (!API_KEY || !DATABASE_URL || !SERVICE_ACCOUNT_JSON) {
    console.error("Missing required GitHub Secrets.");
    process.exit(1);
}

let serviceAccount;

try {
    serviceAccount = JSON.parse(SERVICE_ACCOUNT_JSON);
} catch (error) {
    console.error(
        "FIREBASE_SERVICE_ACCOUNT is not valid JSON."
    );

    process.exit(1);
}

/*
 * Firebase initialization
 */

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
});

const db = admin.database();

/*
 * API PROVIDER
 *
 * നിലവിൽ API-Football ആണ് പ്രവർത്തിക്കുന്നത്.
 * മറ്റൊരു provider ചേർക്കുമ്പോൾ അതിന്റെ adapter ഇവിടെ ചേർക്കാം.
 */

function createProvider() {

    if (API_PROVIDER === "apifootball") {

        return {
            name: "apifootball",

            async fetchFixtures(date) {

                const response = await axios.get(
                    "https://v3.football.api-sports.io/fixtures",
                    {
                        timeout: 30000,

                        headers: {
                            "x-apisports-key": API_KEY
                        },

                        params: {
                            date: date,
                            timezone: TIMEZONE
                        }
                    }
                );

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
        };
    }

    throw new Error(
        "Unsupported API_PROVIDER: " + API_PROVIDER
    );
}

const provider = createProvider();

/*
 * DATE HELPERS
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

    const parts = new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: TIMEZONE
    }).formatToParts(date);

    let day = "";
    let month = "";
    let year = "";

    for (const part of parts) {

        if (part.type === "day") {
            day = part.value;
        }

        if (part.type === "month") {
            month = part.value;
        }

        if (part.type === "year") {
            year = part.value;
        }
    }

    return day + "-" + month + "-" + year;
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

/*
 * STATUS CONVERSION
 */

function getStatus(shortStatus, longStatus) {

    const status = String(
        shortStatus || ""
    ).toUpperCase();

    if (
        ["1H", "2H", "ET", "BT", "P", "LIVE"].includes(status)
    ) {
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
 * PROVIDER RESPONSE -> COMMON MATCH MODEL
 *
 * MatchModel.java fields:
 *
 * gameId              int
 * competitionId       int
 * league              String
 * home                String
 * away                String
 * score               String
 * status              String
 * shortStatus         String
 * streamUrl           String
 * date                String
 * time                String
 * stadium             String
 * matchTimeMillis     long
 * homeLogo            String
 * awayLogo            String
 *
 * Additional API metadata is also retained.
 */

function convertFixture(item) {

    const fixture = item.fixture || {};
    const league = item.league || {};
    const teams = item.teams || {};
    const goals = item.goals || {};
    const status = fixture.status || {};
    const venue = fixture.venue || {};

    const fixtureId = Number(fixture.id || 0);

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

        gameId: fixtureId,

        competitionId: Number(league.id || 0),

        league: String(league.name || ""),

        home: String(
            (teams.home || {}).name || ""
        ),

        away: String(
            (teams.away || {}).name || ""
        ),

        score: homeScore + " - " + awayScore,

        status: getStatus(
            status.short,
            status.long
        ),

        shortStatus: String(
            status.short || "NS"
        ),

        streamUrl: "",

        date: formatDate(fixtureDate),

        time: formatTime(fixtureDate),

        stadium: String(venue.name || ""),

        matchTimeMillis: timestamp * 1000,

        homeLogo: String(
            (teams.home || {}).logo || ""
        ),

        awayLogo: String(
            (teams.away || {}).logo || ""
        ),

        /*
         * Extra metadata
         */

        fixtureId: String(fixtureId),

        apiProvider: API_PROVIDER,

        apiFixtureId: String(fixtureId),

        competition: String(league.name || ""),

        country: String(league.country || ""),

        season: Number(league.season || 0),

        timestamp: timestamp,

        homeScore: homeScore,

        awayScore: awayScore,

        elapsed: status.elapsed == null
            ? 0
            : status.elapsed,

        lastUpdated: Date.now()
    };
}

/*
 * FETCH FIXTURES
 */

async function fetchFixturesForDate(date) {

    console.log(
        "Fetching fixtures for:",
        date
    );

    return await provider.fetchFixtures(date);
}

/*
 * FETCH YESTERDAY, TODAY AND TOMORROW
 *
 * Each date is requested only once during this run.
 */

async function fetchAvailableFixtureMap() {

    const dates = [
        getLocalDate(-1),
        getLocalDate(0),
        getLocalDate(1)
    ];

    const fixtureMap = {};

    let successfulDates = 0;

    for (const date of dates) {

        try {

            const fixtures =
                await fetchFixturesForDate(date);

            successfulDates++;

            console.log(
                "Fixtures received for " +
                date + ": " +
                fixtures.length
            );

            for (const item of fixtures) {

                const match = convertFixture(item);

                if (match && match.gameId) {

                    fixtureMap[String(match.gameId)] = {
                        source: item,
                        match: match
                    };
                }
            }

        } catch (error) {

            console.error(
                "Could not fetch " +
                date + ": " +
                error.message
            );
        }
    }

    if (successfulDates === 0) {

        throw new Error(
            "All date requests failed. " +
            "Existing Firebase data was preserved."
        );
    }

    return {
        fixtureMap: fixtureMap,
        successfulDates: successfulDates,
        requestedDates: dates
    };
}

/*
 * SYNC AVAILABLE MATCHES
 *
 * Existing records are not deleted.
 */

async function syncAvailableMatches(fixtureMap) {

    const ids = Object.keys(fixtureMap);

    if (ids.length === 0) {

        console.log(
            "No fixtures returned. " +
            "Existing availableMatches data preserved."
        );

        return;
    }

    let updated = 0;

    for (const fixtureId of ids) {

        try {

            const incoming =
                fixtureMap[fixtureId].match;

            const ref = db
                .ref("availableMatches")
                .child(fixtureId);

            const snapshot = await ref.once("value");

            const existing = snapshot.val() || {};

            /*
             * Do not overwrite a stream URL manually saved
             * for this fixture in availableMatches.
             */

            incoming.streamUrl =
                existing.streamUrl || "";

            /*
             * Update only the current fixture.
             * No Firebase records are deleted.
             */

            await ref.update(incoming);

            updated++;

        } catch (error) {

            console.error(
                "Failed available match " +
                fixtureId + ": " +
                error.message
            );
        }
    }

    console.log(
        "Available matches updated:",
        updated
    );
}

/*
 * READ SELECTED FIXTURES
 *
 * Supported selection values:
 *
 * selectedFixtures/{fixtureId} = true
 *
 * or
 *
 * selectedFixtures/{fixtureId}/selected = true
 */

function getSelectedFixtureIds(selections) {

    return Object.keys(selections || {}).filter(
        function(id) {

            const value = selections[id];

            if (value === true) {
                return true;
            }

            if (
                value &&
                typeof value === "object" &&
                value.selected === true
            ) {
                return true;
            }

            return false;
        }
    );
}

/*
 * SYNC SELECTED MATCHES
 *
 * Uses the fixture data already fetched above.
 * It does not make one extra API call per selected fixture.
 */

async function syncSelectedMatches(fixtureMap) {

    const snapshot = await db
        .ref("selectedFixtures")
        .once("value");

    const selections = snapshot.val() || {};

    const selectedIds =
        getSelectedFixtureIds(selections);

    console.log(
        "Selected fixture count:",
        selectedIds.length
    );

    if (selectedIds.length === 0) {

        console.log("No selected fixtures.");
        return;
    }

    let updated = 0;
    let notFound = 0;

    for (const fixtureId of selectedIds) {

        try {

            const entry = fixtureMap[String(fixtureId)];

            if (!entry) {

                console.log(
                    "Selected fixture not found in fetched dates:",
                    fixtureId
                );

                notFound++;
                continue;
            }

            const incoming = Object.assign(
                {},
                entry.match
            );

            const ref = db
                .ref("matches")
                .child(String(fixtureId));

            const oldSnapshot = await ref.once("value");

            const existing = oldSnapshot.val() || {};

            /*
             * Keep Admin-entered stream URL.
             */

            incoming.streamUrl =
                existing.streamUrl || "";

            /*
             * Preserve existing IDs where available.
             */

            incoming.gameId = Number(
                existing.gameId || incoming.gameId
            );

            incoming.competitionId = Number(
                incoming.competitionId || 0
            );

            /*
             * update() preserves fields not included in incoming.
             * This avoids deleting additional existing fields.
             */

            await ref.update(incoming);

            updated++;

            console.log(
                "Updated selected match:",
                incoming.home,
                "vs",
                incoming.away,
                "|",
                incoming.score,
                "|",
                incoming.status
            );

        } catch (error) {

            console.error(
                "Failed selected fixture " +
                fixtureId + ": " +
                error.message
            );
        }
    }

    console.log(
        "Selected matches updated:",
        updated
    );

    console.log(
        "Selected matches not found:",
        notFound
    );
}

/*
 * MAIN
 */

async function main() {

    console.log("================================");
    console.log("SportsHub sync started.");
    console.log("Provider:", API_PROVIDER);
    console.log("Timezone:", TIMEZONE);
    console.log("================================");

    /*
     * Fetch fixture lists once and share them between
     * availableMatches and selected-match synchronization.
     */

    const result = await fetchAvailableFixtureMap();

    const fixtureMap = result.fixtureMap;

    console.log(
        "Unique fixtures fetched:",
        Object.keys(fixtureMap).length
    );

    console.log(
        "Successful date requests:",
        result.successfulDates,
        "/",
        result.requestedDates.length
    );

    await syncAvailableMatches(fixtureMap);

    await syncSelectedMatches(fixtureMap);

    console.log("SportsHub sync completed.");
}

/*
 * START
 */

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

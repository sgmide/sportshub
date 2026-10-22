"use strict";

const admin = require("firebase-admin");
const axios = require("axios");

const DEFAULT_API_URL =
    "https://v3.football.api-sports.io/fixtures";

const TIME_ZONE = "Asia/Kolkata";
const PROVIDER = "apifootball";

const API_KEY = process.env.API_FOOTBALL_KEY;
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL;

if (!API_KEY) {
    console.error("ERROR: API_FOOTBALL_KEY is missing.");
    process.exit(1);
}

if (!DATABASE_URL) {
    console.error("ERROR: FIREBASE_DATABASE_URL is missing.");
    process.exit(1);
}

/* ---------------- FIREBASE ---------------- */

function initializeFirebase() {
    if (admin.apps.length > 0) {
        return;
    }

    let serviceAccount;

    try {
        serviceAccount = JSON.parse(
            process.env.FIREBASE_SERVICE_ACCOUNT || "{}"
        );
    } catch (e) {
        console.error("Invalid FIREBASE_SERVICE_ACCOUNT JSON.");
        process.exit(1);
    }

    if (!serviceAccount.project_id) {
        console.error("Firebase service account is missing.");
        process.exit(1);
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: DATABASE_URL
    });
}

const db = admin.database();

/* ---------------- DATE HELPERS ---------------- */

function getIndiaDateParts(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const result = {};

    parts.forEach(function (part) {
        if (part.type !== "literal") {
            result[part.type] = part.value;
        }
    });

    return result;
}

function getDateOffset(offset) {
    const parts = getIndiaDateParts(new Date());

    const date = new Date(Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day) + offset
    ));

    return date.getUTCFullYear() + "-" +
        String(date.getUTCMonth() + 1).padStart(2, "0") + "-" +
        String(date.getUTCDate()).padStart(2, "0");
}

function getAllowedDates() {
    return [
        getDateOffset(-1),
        getDateOffset(0),
        getDateOffset(1)
    ];
}

function getIndiaDateFromTimestamp(timestamp) {
    if (!timestamp || !Number.isFinite(Number(timestamp))) {
        return null;
    }

    const date = new Date(Number(timestamp));

    if (isNaN(date.getTime())) {
        return null;
    }

    const parts = getIndiaDateParts(date);

    return parts.year + "-" +
        parts.month + "-" +
        parts.day;
}

function getFixtureDate(fixture) {
    if (
        fixture &&
        fixture.fixture &&
        fixture.fixture.date
    ) {
        const date = new Date(fixture.fixture.date);

        if (!isNaN(date.getTime())) {
            return getIndiaDateFromTimestamp(date.getTime());
        }
    }

    return null;
}

function getExistingMatchDate(match) {
    if (!match) {
        return null;
    }

    if (match.matchTimeMillis) {
        const date = getIndiaDateFromTimestamp(
            match.matchTimeMillis
        );

        if (date) {
            return date;
        }
    }

    if (match.timestamp) {
        const timestamp = Number(match.timestamp);

        if (Number.isFinite(timestamp)) {
            const date = getIndiaDateFromTimestamp(
                timestamp < 100000000000
                    ? timestamp * 1000
                    : timestamp
            );

            if (date) {
                return date;
            }
        }
    }

    if (match.date) {
        const value = String(match.date);

        // Existing format: dd-MM-yyyy
        const dmy = value.match(
            /^(\d{2})-(\d{2})-(\d{4})$/
        );

        if (dmy) {
            return dmy[3] + "-" +
                dmy[2] + "-" +
                dmy[1];
        }

        const parsed = new Date(value);

        if (!isNaN(parsed.getTime())) {
            return getIndiaDateFromTimestamp(
                parsed.getTime()
            );
        }
    }

    return null;
}

function formatDate(timestamp) {
    const date = new Date(timestamp);

    if (isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(date).replace(/\//g, "-");
}

/* ---------------- API REQUEST ---------------- */

async function fetchFixtures(params) {
    const response = await axios.get(DEFAULT_API_URL, {
        params: params,
        timeout: 30000,
        headers: {
            "x-apisports-key": API_KEY
        }
    });

    if (
        !response.data ||
        !Array.isArray(response.data.response)
    ) {
        throw new Error(
            "Invalid API response: fixtures array missing."
        );
    }

    if (
        response.data.errors &&
        Object.keys(response.data.errors).length > 0
    ) {
        throw new Error(
            JSON.stringify(response.data.errors)
        );
    }

    return response.data.response;
}

/*
 * Fetch yesterday, today, tomorrow and live fixtures.
 * Cleanup is allowed only when ALL four requests succeed.
 */

async function fetchAllFixtures() {
    const dates = [
        getDateOffset(-1),
        getDateOffset(0),
        getDateOffset(1)
    ];

    const requests = [];

    dates.forEach(function (date) {
        requests.push({
            name: "date_" + date,
            params: {
                date: date,
                timezone: TIME_ZONE
            }
        });
    });

    requests.push({
        name: "live",
        params: {
            live: "all",
            timezone: TIME_ZONE
        }
    });

    const fixtureMap = {};
    const failedRequests = [];

    for (let i = 0; i < requests.length; i++) {
        const request = requests[i];

        try {
            console.log(
                "Fetching fixtures:",
                request.name
            );

            const fixtures = await fetchFixtures(
                request.params
            );

            fixtures.forEach(function (fixture) {
                const id = fixture &&
                    fixture.fixture &&
                    fixture.fixture.id;

                if (id != null) {
                    fixtureMap[String(id)] = fixture;
                }
            });

            console.log(
                request.name + ": " +
                fixtures.length + " fixtures"
            );
        } catch (error) {
            console.error(
                "Request failed:",
                request.name,
                error.message
            );

            failedRequests.push(request.name);
        }
    }

    return {
        fixtures: Object.keys(fixtureMap).map(
            function (key) {
                return fixtureMap[key];
            }
        ),
        complete: failedRequests.length === 0,
        failedRequests: failedRequests,
        dates: dates
    };
}

/* ---------------- SELECTION ---------------- */

function isCompetitionSelected(selection) {
    if (selection === true || selection === 1) {
        return true;
    }

    if (!selection || typeof selection !== "object") {
        return false;
    }

    return selection.selected === true ||
        selection.enabled === true;
}

/* ---------------- MATCH CONVERSION ---------------- */

function convertFixture(
    fixture,
    existingMatch,
    competitionSelected
) {
    const old = existingMatch || {};

    const fixtureData = fixture.fixture || {};
    const league = fixture.league || {};
    const teams = fixture.teams || {};
    const goals = fixture.goals || {};
    const score = fixture.score || {};

    const home = teams.home || {};
    const away = teams.away || {};
    const status = fixtureData.status || {};

    const timestamp = fixtureData.timestamp
        ? Number(fixtureData.timestamp) * 1000
        : new Date(fixtureData.date).getTime();

    const homeGoals = goals.home == null
        ? null
        : goals.home;

    const awayGoals = goals.away == null
        ? null
        : goals.away;

    const fixtureId = String(fixtureData.id);

    const match = Object.assign({}, old, {
        gameId: fixtureId,
        apiFixtureId: fixtureId,
        apiProvider: PROVIDER,

        competitionId: String(league.id || ""),
        competitionName: league.name || "",
        leagueId: String(league.id || ""),
        leagueName: league.name || "",

        season: league.season || "",
        round: league.round || "",

        homeTeam: home.name || "",
        awayTeam: away.name || "",

        homeTeamId: home.id || "",
        awayTeamId: away.id || "",

        homeLogo: home.logo || "",
        awayLogo: away.logo || "",

        homeScore: homeGoals,
        awayScore: awayGoals,

        goalsHome: homeGoals,
        goalsAway: awayGoals,

        halftimeHome: score.halftime
            ? score.halftime.home
            : null,

        halftimeAway: score.halftime
            ? score.halftime.away
            : null,

        fulltimeHome: score.fulltime
            ? score.fulltime.home
            : null,

        fulltimeAway: score.fulltime
            ? score.fulltime.away
            : null,

        date: formatDate(timestamp),
        timestamp: timestamp,
        matchTimeMillis: timestamp,

        status: status.long || "",
        shortStatus: status.short || "",
        elapsed: status.elapsed == null
            ? null
            : status.elapsed,

        venue: fixtureData.venue
            ? fixtureData.venue.name || ""
            : "",

        referee: fixtureData.referee || "",

        competitionSelected: competitionSelected,
        updatedAt: Date.now()
    });

    /*
     * Admin fields are preserved from the old record.
     * Do not overwrite streamUrl, channels, goalEvents,
     * adminNotes, or other Admin-managed values.
     */

    return match;
}

/* ---------------- MAIN SYNC ---------------- */

async function main() {
    initializeFirebase();

    console.log("Sports Hub API-Football sync started.");

    const rootSnapshot = await db.ref().once("value");
    const root = rootSnapshot.val() || {};

    const settings = root.syncSettings || {};

    const competitions = root.competitions || {};
    const competitionSelection =
        root.competition_selection || {};

    const existingMatches = root.matches || {};

    /*
     * Only run this parser when selected_parser points
     * to API-Football.
     */

    const selectedParser = String(
        settings.selected_parser || ""
    ).toLowerCase();

    const configuredParser = String(
        settings.api_parser || ""
    ).toLowerCase();

    const activeParser = configuredParser ||
        selectedParser;

    if (
        activeParser &&
        activeParser !== "apifootball" &&
        activeParser !== "api-football" &&
        activeParser !== "api_football"
    ) {
        console.log(
            "Skipping: active parser is " + activeParser
        );

        return;
    }

    const fetchResult = await fetchAllFixtures();

    const fixtures = fetchResult.fixtures;
    const allowedDates = getAllowedDates();
    const allowedDateSet = new Set(allowedDates);

    console.log("Allowed dates:", allowedDates.join(", "));
    console.log("Fetched fixtures:", fixtures.length);

    if (fetchResult.failedRequests.length > 0) {
        console.error(
            "WARNING: Some API requests failed:",
            fetchResult.failedRequests.join(", ")
        );

        console.error(
            "Cleanup will be skipped to protect existing matches."
        );
    }

    const updates = {};

    const seenMatchKeys = new Set();
    const selectedFixtureIds = new Set();

    let savedCount = 0;
    let skippedUnselected = 0;
    let skippedOutsideWindow = 0;

    /*
     * Preserve existing competition-selection settings.
     * Only update competition metadata for competitions
     * returned by the API.
     */

    const discoveredCompetitions = {};

    fixtures.forEach(function (fixture) {
        const league = fixture.league || {};

        if (league.id == null) {
            return;
        }

        const competitionId = String(league.id);

        discoveredCompetitions[competitionId] = {
            id: competitionId,
            name: league.name || "",
            country: league.country || "",
            logo: league.logo || "",
            flag: league.flag || "",
            season: league.season || "",
            sportId: "football",
            apiProvider: PROVIDER
        };
    });

    Object.keys(discoveredCompetitions).forEach(
        function (competitionId) {
            const discovered =
                discoveredCompetitions[competitionId];

            const oldCompetition =
                competitions[competitionId] || {};

            updates[
                "competitions/" + competitionId
            ] = Object.assign(
                {},
                oldCompetition,
                discovered
            );

            /*
             * Do not automatically select a competition.
             * Keep the user's existing selection setting.
             */
        }
    );

    /*
     * Prepare matches ONLY for selected competitions
     * and ONLY for yesterday/today/tomorrow.
     */

    fixtures.forEach(function (fixture) {
        const fixtureData = fixture.fixture || {};
        const league = fixture.league || {};

        if (
            fixtureData.id == null ||
            league.id == null
        ) {
            return;
        }

        const fixtureId = String(fixtureData.id);
        const competitionId = String(league.id);

        const selection =
            competitionSelection[competitionId];

        const selected =
            isCompetitionSelected(selection);

        if (!selected) {
            skippedUnselected++;
            return;
        }

        const fixtureDate = getFixtureDate(fixture);

        if (
            !fixtureDate ||
            !allowedDateSet.has(fixtureDate)
        ) {
            skippedOutsideWindow++;
            return;
        }

        const existing = existingMatches[fixtureId] || {};

        const match = convertFixture(
            fixture,
            existing,
            true
        );

        updates["matches/" + fixtureId] = match;

        seenMatchKeys.add(fixtureId);
        selectedFixtureIds.add(fixtureId);

        savedCount++;
    });

    /*
     * Delete stale API-Football matches only when every
     * request succeeded.
     *
     * Do not delete records from another provider.
     * Remove API-Football records when:
     *  - their competition is no longer selected, OR
     *  - their date is outside yesterday/today/tomorrow, OR
     *  - they are absent from the complete API result.
     *
     * The final condition also removes matches that have
     * disappeared from the API.
     */

    let deletedCount = 0;

    if (fetchResult.complete) {
        Object.keys(existingMatches).forEach(
            function (matchKey) {
                const match = existingMatches[matchKey];

                if (!match || typeof match !== "object") {
                    return;
                }

                const provider = String(
                    match.apiProvider || ""
                ).toLowerCase();

                /*
                 * Safety: only delete records explicitly
                 * identified as API-Football.
                 */

                if (
                    provider !== "apifootball" &&
                    provider !== "api-football" &&
                    provider !== "api_football"
                ) {
                    return;
                }

                /*
                 * A record refreshed in this sync must
                 * never be deleted.
                 */

                if (seenMatchKeys.has(String(matchKey))) {
                    return;
                }

                const competitionId = String(
                    match.competitionId ||
                    match.leagueId ||
                    ""
                );

                const selected = isCompetitionSelected(
                    competitionSelection[competitionId]
                );

                const existingDate =
                    getExistingMatchDate(match);

                const outsideWindow =
                    !existingDate ||
                    !allowedDateSet.has(existingDate);

                /*
                 * API result is complete. If this old match
                 * is not in the refreshed set, it is stale,
                 * outside the window, or no longer selected.
                 */

                if (
                    !selected ||
                    outsideWindow ||
                    !selectedFixtureIds.has(String(matchKey))
                ) {
                    updates["matches/" + matchKey] = null;
                    deletedCount++;
                }
            }
        );
    }

    /*
     * If API requests were incomplete, do not delete
     * existing matches. The records successfully fetched
     * above can still be refreshed.
     */

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    }

    console.log("--------------------------------");
    console.log("API-Football sync finished.");
    console.log("Dates:", allowedDates.join(", "));
    console.log("Fetched fixtures:", fixtures.length);
    console.log("Matches saved:", savedCount);
    console.log("Skipped - competition not selected:",
        skippedUnselected);
    console.log("Skipped - outside date window:",
        skippedOutsideWindow);

    if (fetchResult.complete) {
        console.log("Old API-Football matches deleted:",
            deletedCount);
    } else {
        console.log(
            "Cleanup skipped because one or more requests failed."
        );
    }

    console.log("--------------------------------");
}

/* ---------------- START ---------------- */

main()
    .then(function () {
        console.log("Sync process completed.");
        process.exit(0);
    })
    .catch(function (error) {
        console.error("Sync failed:", error);
        process.exit(1);
    });


"use strict";

const admin = require("firebase-admin");
const axios = require("axios");

const TIMEZONE = "Asia/Kolkata";
const DEFAULT_PROVIDER = "apifootball";

function getPath(obj, path) {
    if (!path) return undefined;

    return path.split(".").reduce(function (value, key) {
        if (value == null) return undefined;

        if (/^\d+$/.test(key)) {
            return value[Number(key)];
        }

        return value[key];
    }, obj);
}

function firstValue(obj, paths, fallback) {
    for (const path of paths) {
        const value = getPath(obj, path);

        if (value !== undefined && value !== null && value !== "") {
            return value;
        }
    }

    return fallback;
}

function toNumber(value, fallback) {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
}

function formatDate(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIMEZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(date);

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    return values.day + "-" + values.month + "-" + values.year;
}

function formatTime(date) {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(date);
}

function dateString(date) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(date);
}

function initFirebase() {
    if (admin.apps.length) return;

    const serviceAccountText =
        process.env.FIREBASE_SERVICE_ACCOUNT;

    const databaseURL =
        process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountText || !databaseURL) {
        throw new Error(
            "Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL"
        );
    }

    admin.initializeApp({
        credential: admin.credential.cert(
            JSON.parse(serviceAccountText)
        ),
        databaseURL: databaseURL
    });
}

function normalizeProvider(value) {
    const provider = String(value || DEFAULT_PROVIDER)
        .trim()
        .toLowerCase();

    if (provider === "365" || provider === "365scores") {
        return "365scores";
    }

    if (
        provider === "api-football" ||
        provider === "api_football" ||
        provider === "apifootball"
    ) {
        return "apifootball";
    }

    return provider;
}

/*
 * Read provider configuration from:
 *
 * settings/apiProviders/{provider}
 *
 * Example:
 * {
 *   "url": "https://example.com/api/matches",
 *   "method": "get",
 *   "headers": {},
 *   "queryParams": {},
 *   "responsePath": "response",
 *   "fields": {
 *     "id": "fixture.id",
 *     "leagueId": "league.id",
 *     "league": "league.name",
 *     "home": "teams.home.name",
 *     "away": "teams.away.name"
 *   }
 * }
 */

async function fetchConfiguredProvider(
    provider,
    config,
    date
) {
    if (!config || !config.url) {
        throw new Error(
            "Missing API configuration for provider: " + provider
        );
    }

    const params = Object.assign({}, config.queryParams || {});

    if (config.dateParam) {
        params[config.dateParam] = date;
    }

    const headers = Object.assign({}, config.headers || {});

    if (config.apiKeyEnv) {
        const apiKey = process.env[config.apiKeyEnv];

        if (!apiKey) {
            throw new Error(
                "Missing API key environment variable: " +
                config.apiKeyEnv
            );
        }

        if (config.apiKeyHeader) {
            headers[config.apiKeyHeader] = apiKey;
        }
    }

    const response = await axios({
        method: config.method || "get",
        url: config.url,
        params: params,
        headers: headers,
        timeout: 30000
    });

    const payload = config.responsePath
        ? getPath(response.data, config.responsePath)
        : response.data;

    if (Array.isArray(payload)) {
        return payload;
    }

    if (payload && typeof payload === "object") {
        if (Array.isArray(payload.games)) return payload.games;
        if (Array.isArray(payload.fixtures)) return payload.fixtures;
        if (Array.isArray(payload.response)) return payload.response;
        if (Array.isArray(payload.events)) return payload.events;
        if (Array.isArray(payload.results)) return payload.results;
    }

    throw new Error(
        "API response does not contain a recognised matches array. " +
        "Configure responsePath for " + provider
    );
}

async function fetchApiFootball(date) {
    const apiKey = process.env.API_FOOTBALL_KEY;

    if (!apiKey) {
        throw new Error("Missing API_FOOTBALL_KEY");
    }

    const response = await axios.get(
        "https://v3.football.api-sports.io/fixtures",
        {
            params: {
                date: date,
                timezone: TIMEZONE
            },
            headers: {
                "x-apisports-key": apiKey
            },
            timeout: 30000
        }
    );

    if (response.data && response.data.errors &&
        Object.keys(response.data.errors).length) {
        throw new Error(
            "API-Football error: " +
            JSON.stringify(response.data.errors)
        );
    }

    if (!Array.isArray(response.data.response)) {
        throw new Error(
            "Invalid API-Football response"
        );
    }

    return response.data.response;
}

function normalizeApiFootball(item) {
    const fixture = item.fixture || {};
    const league = item.league || {};
    const teams = item.teams || {};
    const goals = item.goals || {};
    const home = teams.home || {};
    const away = teams.away || {};
    const statusInfo = fixture.status || {};

    const timestamp = toNumber(fixture.timestamp, 0);
    const date = timestamp
        ? new Date(timestamp * 1000)
        : new Date();

    const homeScore = goals.home;
    const awayScore = goals.away;

    return {
        gameId: toNumber(fixture.id, 0),
        apiFixtureId: String(fixture.id || ""),
        apiProvider: "apifootball",

        competitionId: toNumber(league.id, 0),
        league: league.name || "Unknown Competition",
        country: league.country || "",
        season: league.season || "",

        home: home.name || "Home",
        away: away.name || "Away",
        homeLogo: home.logo || "",
        awayLogo: away.logo || "",

        homeScore: homeScore,
        awayScore: awayScore,

        score:
            homeScore != null && awayScore != null
                ? homeScore + " - " + awayScore
                : "VS",

        status: statusInfo.long || "Not Started",
        shortStatus: statusInfo.short || "NS",
        elapsed: statusInfo.elapsed,

        date: formatDate(date),
        time: formatTime(date),
        timestamp: timestamp,
        matchTimeMillis: timestamp * 1000,

        stadium: fixture.venue
            ? fixture.venue.name || ""
            : "",

        updatedAt: Date.now()
    };
}

function normalizeConfigured(item, provider, config) {
    const fields = config.fields || {};

    function read(name, fallbacks, fallback) {
        if (fields[name]) {
            const value = getPath(item, fields[name]);

            if (value !== undefined && value !== null) {
                return value;
            }
        }

        return firstValue(item, fallbacks || [], fallback);
    }

    const id = read("id", [
        "id",
        "gameId",
        "fixture.id",
        "game.id"
    ], null);

    if (id == null) return null;

    const timestampValue = read("timestamp", [
        "timestamp",
        "fixture.timestamp",
        "startTime",
        "startTimestamp"
    ], 0);

    let timestamp = toNumber(timestampValue, 0);

    if (timestamp > 0 && timestamp < 100000000000) {
        timestamp *= 1000;
    }

    let date = timestamp
        ? new Date(timestamp)
        : new Date();

    const home = read("home", [
        "home.name",
        "homeTeam.name",
        "homeCompetitor.name",
        "competitors.0.name",
        "teams.home.name"
    ], "Home");

    const away = read("away", [
        "away.name",
        "awayTeam.name",
        "awayCompetitor.name",
        "competitors.1.name",
        "teams.away.name"
    ], "Away");

    const homeScore = read("homeScore", [
        "homeScore",
        "scores.home",
        "score.home",
        "homeCompetitor.score",
        "scores.0"
    ], null);

    const awayScore = read("awayScore", [
        "awayScore",
        "scores.away",
        "score.away",
        "awayCompetitor.score",
        "scores.1"
    ], null);

    const competitionId = read("leagueId", [
        "competitionId",
        "competition.id",
        "league.id",
        "tournament.id"
    ], 0);

    const league = read("league", [
        "competition.name",
        "league.name",
        "tournament.name",
        "competitionName"
    ], "Unknown Competition");

    const shortStatus = read("shortStatus", [
        "shortStatus",
        "status.short",
        "status.code",
        "status"
    ], "NS");

    const status = read("status", [
        "status.long",
        "status.name",
        "status"
    ], "Not Started");

    const homeLogo = read("homeLogo", [
        "home.logo",
        "homeTeam.logo",
        "homeCompetitor.image",
        "teams.home.logo"
    ], "");

    const awayLogo = read("awayLogo", [
        "away.logo",
        "awayTeam.logo",
        "awayCompetitor.image",
        "teams.away.logo"
    ], "");

    return {
        gameId: String(id),
        apiFixtureId: String(id),
        apiProvider: provider,

        competitionId: String(competitionId || ""),
        league: String(league),
        country: String(read("country", [
            "country.name",
            "country",
            "league.country"
        ], "")),

        home: String(home),
        away: String(away),
        homeLogo: homeLogo || "",
        awayLogo: awayLogo || "",

        homeScore: homeScore,
        awayScore: awayScore,
        score:
            homeScore != null && awayScore != null
                ? homeScore + " - " + awayScore
                : "VS",

        status: String(status),
        shortStatus: String(shortStatus),

        date: formatDate(date),
        time: formatTime(date),
        timestamp: Math.floor(date.getTime() / 1000),
        matchTimeMillis: date.getTime(),

        stadium: String(read("stadium", [
            "venue.name",
            "stadium",
            "venue"
        ], "")),

        updatedAt: Date.now()
    };
}

async function main() {
    initFirebase();

    const db = admin.database();
    const settingsRef = db.ref("settings");

    const settingsSnapshot = await settingsRef.once("value");
    const settings = settingsSnapshot.val() || {};

    const provider = normalizeProvider(
        process.env.API_PROVIDER ||
        settings.apiProvider ||
        DEFAULT_PROVIDER
    );

    const previousProvider = normalizeProvider(
        settings.last_synced_api_provider || ""
    );

    const dates = [];
    const today = new Date();

    for (let offset = -1; offset <= 1; offset++) {
        const date = new Date(today);
        date.setDate(date.getDate() + offset);
        dates.push(dateString(date));
    }

    const allMatches = {};
    let successfulRequests = 0;
    let errors = [];

    let providerConfig = null;

    if (provider !== "apifootball") {
        const configSnapshot = await db
            .ref("settings/apiProviders/" + provider)
            .once("value");

        providerConfig = configSnapshot.val();

        if (!providerConfig) {
            throw new Error(
                "No settings/apiProviders/" + provider +
                " configuration found in Firebase"
            );
        }
    }

    for (const date of dates) {
        try {
            let items;

            if (provider === "apifootball") {
                items = await fetchApiFootball(date);
            } else {
                items = await fetchConfiguredProvider(
                    provider,
                    providerConfig,
                    date
                );
            }

            successfulRequests++;

            for (const item of items) {
                let match;

                if (provider === "apifootball") {
                    match = normalizeApiFootball(item);
                } else {
                    match = normalizeConfigured(
                        item,
                        provider,
                        providerConfig
                    );
                }

                if (!match || !match.gameId) continue;

                const key = String(match.gameId)
                    .replace(/[.#$[\]/]/g, "_");

                allMatches[key] = match;
            }

            console.log(
                "Fetched " + items.length +
                " records for " + date
            );
        } catch (error) {
            errors.push(date + ": " + error.message);
            console.error("Fetch failed:", date, error.message);
        }
    }

    if (successfulRequests === 0) {
        throw new Error(
            "All API requests failed. Firebase data was not changed. " +
            errors.join(" | ")
        );
    }

    if (Object.keys(allMatches).length === 0) {
        console.log(
            "No matches returned. Existing match data will be preserved."
        );
        return;
    }

    const providerChanged =
        previousProvider &&
        previousProvider !== provider;

    const updates = {};

    if (providerChanged) {
        console.log(
            "Provider changed from " +
            previousProvider + " to " + provider +
            ". Resetting old provider data."
        );

        updates.matches = null;
        updates.availableMatches = null;
        updates.competitions = null;
        updates.competition_selection = null;
        updates.selectedFixtures = null;
    }

    const oldCompetitionsSnapshot = providerChanged
        ? null
        : await db.ref("competitions").once("value");

    const oldSelectionsSnapshot = providerChanged
        ? null
        : await db.ref("competition_selection").once("value");

    const oldCompetitions =
        oldCompetitionsSnapshot
            ? oldCompetitionsSnapshot.val() || {}
            : {};

    const oldSelections =
        oldSelectionsSnapshot
            ? oldSelectionsSnapshot.val() || {}
            : {};

    const competitions = {};
    const selectedMatches = {};

    for (const key of Object.keys(allMatches)) {
        const match = allMatches[key];
        const competitionId = String(match.competitionId || "");

        if (competitionId) {
            const oldCompetition = oldCompetitions[competitionId] || {};

            const selected = oldSelections[competitionId] === true ||
                oldCompetition.selected === true;

            competitions[competitionId] = {
                id: competitionId,
                name: match.league,
                sportId: 1,
                selected: selected,
                apiProvider: provider
            };

            if (selected) {
                selectedMatches[key] = match;
            }
        }
    }

    updates.availableMatches = allMatches;
    updates.competitions = competitions;
    updates.matches = selectedMatches;

    updates.settings = Object.assign({}, settings, {
        last_synced_api_provider: provider,
        lastSuccessfulSync: Date.now(),
        lastSyncMatchCount: Object.keys(allMatches).length,
        lastSyncError: errors.length ? errors.join(" | ") : ""
    });

    await db.ref().update(updates);

    console.log("Provider:", provider);
    console.log("Fetched matches:", Object.keys(allMatches).length);
    console.log("Selected matches:", Object.keys(selectedMatches).length);
    console.log("Sync complete.");
}

main().catch(function (error) {
    console.error("Sync failed:", error);
    process.exitCode = 1;
});

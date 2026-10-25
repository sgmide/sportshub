
"use strict";

const axios = require("axios");

const BASE_URL = "https://v3.football.api-sports.io";
const TIME_ZONE = "Asia/Kolkata";

// Events fetch ചെയ്യുമ്പോൾ ഒരേസമയം പരിമിതമായ requests മാത്രം.
const EVENT_CONCURRENCY = 3;

// അടുത്തിടെ നടന്ന മത്സരങ്ങൾക്ക് മാത്രം events fetch ചെയ്യും.
const RECENT_MATCH_HOURS = 24;

function getApiKey(settings) {
    settings = settings || {};

    return process.env.API_FOOTBALL_KEY ||
        process.env.APISPORTS_KEY ||
        settings.apiFootballKey ||
        "";
}

function getBaseUrl(parserSettings) {
    parserSettings = parserSettings || {};

    let url = String(
        parserSettings.api_url ||
        BASE_URL
    ).replace(/\/+$/, "");

    url = url.replace(/\/fixtures$/i, "");
    url = url.replace(/\/leagues$/i, "");
    url = url.replace(/\/events$/i, "");

    return url || BASE_URL;
}

async function apiGet(endpoint, params, settings, parserSettings) {
    const apiKey = getApiKey(settings);

    if (!apiKey) {
        throw new Error("API_FOOTBALL_KEY secret is missing");
    }

    const url = getBaseUrl(parserSettings) + endpoint;

    const response = await axios.get(url, {
        timeout: 30000,
        params: params || {},
        headers: {
            "x-apisports-key": apiKey,
            "Accept": "application/json"
        }
    });

    const data = response.data || {};

    if (data.errors && Object.keys(data.errors).length > 0) {
        throw new Error(
            "API-Football error: " + JSON.stringify(data.errors)
        );
    }

    if (!Array.isArray(data.response)) {
        throw new Error("Unexpected API-Football response");
    }

    return data.response;
}

function toMillis(value) {
    if (!value) return 0;

    const parsed = Date.parse(value);

    return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrZero(value) {
    if (value == null || value === "") return 0;

    const number = Number(value);

    return Number.isFinite(number) ? number : 0;
}

function normalizeEvents(events) {
    if (!Array.isArray(events)) {
        return [];
    }

    return events
        .filter(function (event) {
            if (!event) return false;

            const type = String(event.type || "").toLowerCase();
            const detail = String(event.detail || "").toLowerCase();

            // Goal സംബന്ധമായ events മാത്രം.
            return type === "goal" ||
                detail.indexOf("goal") !== -1 ||
                detail === "penalty" ||
                detail === "own goal";
        })
        .map(function (event) {
            const team = event.team || {};
            const player = event.player || {};
            const assist = event.assist || {};
            const time = event.time || {};

            let minute = "";

            if (time.elapsed != null) {
                minute = String(time.elapsed);

                if (time.extra != null && Number(time.extra) > 0) {
                    minute += "+" + String(time.extra);
                }
            }

            return {
                competitorId: numberOrZero(team.id),
                gameTime: minute,
                playerId: numberOrZero(player.id),
                playerName: String(player.name || ""),
                type: String(
                    event.detail || event.type || "Goal"
                ),
                assistId: numberOrZero(assist.id),
                assistName: String(assist.name || "")
            };
        });
}

function normalize(fixture) {
    if (!fixture ||
            !fixture.fixture ||
            fixture.fixture.id == null) {
        return null;
    }

    const info = fixture.fixture;
    const league = fixture.league || {};
    const teams = fixture.teams || {};
    const goals = fixture.goals || {};
    const scores = fixture.score || {};
    const home = teams.home || {};
    const away = teams.away || {};
    const statusInfo = info.status || {};

    const status = statusInfo.short || "NS";
    const elapsed = statusInfo.elapsed;

    const liveStatuses = [
        "1H", "2H", "HT", "ET", "BT", "P", "LIVE"
    ];

    const displayStatus =
        elapsed != null && liveStatuses.indexOf(status) !== -1
            ? String(elapsed) + "'"
            : status;

    const halftime = scores.halftime || {};
    const fulltime = scores.fulltime || {};
    const extratime = scores.extratime || {};
    const penalty = scores.penalty || {};
    const venue = info.venue || {};
    const timestamp = toMillis(info.date);

    return {
        gameId: Number(info.id),
        apiFixtureId: Number(info.id),
        apiProvider: "api-football",
        sportId: 1,

        competitionId: numberOrZero(league.id),
        competitionName: league.name || "",
        country: league.country || "",
        competitionLogo: league.logo || "",
        competitionFlag: league.flag || "",
        season: numberOrZero(league.season),
        round: league.round || "",

        homeCompetitorId: numberOrZero(home.id),
        awayCompetitorId: numberOrZero(away.id),
        homeTeam: home.name || "Home",
        awayTeam: away.name || "Away",
        homeLogo: home.logo || "",
        awayLogo: away.logo || "",

        homeScore: goals.home,
        awayScore: goals.away,
        halftimeHomeScore: halftime.home,
        halftimeAwayScore: halftime.away,
        fulltimeHomeScore: fulltime.home,
        fulltimeAwayScore: fulltime.away,
        extratimeHomeScore: extratime.home,
        extratimeAwayScore: extratime.away,
        penaltyHomeScore: penalty.home,
        penaltyAwayScore: penalty.away,

        goalEvents: normalizeEvents(fixture.goalEvents),

        timestamp: timestamp,
        matchTimeMillis: timestamp,
        status: displayStatus,
        shortStatus: status,

        venue: venue.name || "",
        stadium: venue.name || "",
        venueCity: venue.city || "",
        streamUrl: ""
    };
}

async function fetchCatalog(options) {
    options = options || {};

    const settings = options.settings || {};
    const parserSettings = options.parserSettings || {};
    const currentYear = new Date().getFullYear();

    const response = await apiGet(
        "/leagues",
        { season: currentYear },
        settings,
        parserSettings
    );

    const competitions = response.map(function (item) {
        const league = item.league || {};
        const country = item.country || {};

        return {
            id: league.id,
            name: league.name || "",
            type: league.type || "",
            logo: league.logo || "",
            country: country.name || "",
            season: currentYear,
            sportId: 1
        };
    }).filter(function (item) {
        return item.id != null && item.name;
    });

    return {
        sports: [
            {
                id: 1,
                name: "Football",
                nameForURL: "football"
            }
        ],
        competitions: competitions
    };
}

/*
 * Match live ആണോ അല്ലെങ്കിൽ അടുത്തിടെ
 * പൂർത്തിയായതാണോ എന്ന് പരിശോധിക്കുന്നു.
 */
function shouldFetchEvents(match) {
    if (!match) return false;

    const status = String(match.shortStatus || "").toUpperCase();

    const liveStatuses = [
        "1H", "2H", "HT", "ET", "BT", "P", "LIVE"
    ];

    if (liveStatuses.indexOf(status) !== -1) {
        return true;
    }

    const finishedStatuses = ["FT", "AET", "PEN"];

    if (finishedStatuses.indexOf(status) === -1) {
        return false;
    }

    const matchTime = Number(match.matchTimeMillis || 0);

    if (!matchTime) return false;

    const age = Date.now() - matchTime;
    const recentWindow = RECENT_MATCH_HOURS * 60 * 60 * 1000;

    return age >= 0 && age <= recentWindow;
}

/*
 * API-Football fixtures/events endpoint.
 */
async function fetchGoalEvents(
    fixtureId,
    settings,
    parserSettings
) {
    const response = await apiGet(
        "/fixtures/events",
        { fixture: fixtureId },
        settings,
        parserSettings
    );

    return normalizeEvents(response);
}

/*
 * Requests limit കുറയ്ക്കാൻ event requests
 * നിയന്ത്രിത concurrency-ൽ പ്രവർത്തിക്കുന്നു.
 */
async function processWithLimit(items, limit, callback) {
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const index = nextIndex++;

            if (index >= items.length) {
                return;
            }

            await callback(items[index]);
        }
    }

    const workers = [];

    for (let i = 0; i < Math.min(limit, items.length); i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
}

async function fetchMatches(options) {
    options = options || {};

    const date = options.date;
    const settings = options.settings || {};
    const parserSettings = options.parserSettings || {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Invalid date. Expected YYYY-MM-DD");
    }

    const response = await apiGet(
        "/fixtures",
        {
            date: date,
            timezone: options.timeZone || TIME_ZONE
        },
        settings,
        parserSettings
    );

    const unique = Object.create(null);

    response.forEach(function (fixture) {
        const match = normalize(fixture);

        if (match) {
            unique[String(match.gameId)] = match;
        }
    });

    const matches = Object.keys(unique).map(function (id) {
        return unique[id];
    });

    const eligibleMatches = matches.filter(shouldFetchEvents);

    console.log(
        "API-Football " + date + ": " +
        matches.length + " fixtures"
    );

    console.log(
        "Goal events requested for " +
        eligibleMatches.length + " live/recent matches"
    );

    await processWithLimit(
        eligibleMatches,
        EVENT_CONCURRENCY,
        async function (match) {
            try {
                match.goalEvents = await fetchGoalEvents(
                    match.gameId,
                    settings,
                    parserSettings
                );

                console.log(
                    "Events loaded for fixture " +
                    match.gameId + ": " +
                    match.goalEvents.length
                );
            } catch (error) {
                // Event request പരാജയപ്പെട്ടാൽ match sync നിർത്തരുത്.
                console.warn(
                    "Could not fetch events for fixture " +
                    match.gameId + ": " +
                    error.message
                );
            }
        }
    );

    return matches;
}

module.exports = {
    fetchCatalog: fetchCatalog,
    fetchMatches: fetchMatches
};

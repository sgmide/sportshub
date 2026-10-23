
"use strict";

const axios = require("axios");

const BASE_URL =
    "https://webws.365scores.com/web/games/";

function formatDate(date) {
    const parts = date.split("-");
    return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function toMillis(value) {
    if (value == null || value === "") {
        return 0;
    }

    if (typeof value === "number") {
        return value < 1000000000000
            ? value * 1000
            : value;
    }

    const parsed = Date.parse(value);

    return Number.isFinite(parsed) ? parsed : 0;
}

function getLogo(competitor) {
    if (!competitor) {
        return "";
    }

    return competitor.logo ||
        competitor.image ||
        competitor.imageUrl ||
        "";
}

function getCompetitors(game) {
    return Array.isArray(game.competitors)
        ? game.competitors
        : [];
}

function getHomeAway(game) {
    const competitors = getCompetitors(game);

    const home = competitors.find(function (item) {
        return item.isHome === true ||
            item.position === "home" ||
            item.qualifier === "home";
    }) || competitors[0] || {};

    const away = competitors.find(function (item) {
        return item.isAway === true ||
            item.position === "away" ||
            item.qualifier === "away";
    }) || competitors[1] || {};

    return {
        home: home,
        away: away
    };
}

function getStatus(game) {
    const status = game.status || {};

    const text = typeof status === "string"
        ? status
        : (
            status.shortName ||
            status.name ||
            status.description ||
            ""
        );

    const minute = game.gameTime != null
        ? String(game.gameTime)
        : "";

    if (minute && /^\d+$/.test(minute)) {
        return minute + "'";
    }

    return String(text || "NS");
}

function getScore(competitor) {
    if (!competitor) {
        return 0;
    }

    if (competitor.score != null) {
        return competitor.score;
    }

    if (competitor.currentScore != null) {
        return competitor.currentScore;
    }

    return 0;
}

/*
 * Preserve goalEvents in the same structure supplied
 * by the API. Never replace a populated array with [].
 */
function getGoalEvents(game) {
    if (Array.isArray(game.goalEvents)) {
        return game.goalEvents;
    }

    if (Array.isArray(game.events)) {
        return game.events;
    }

    return [];
}

function getDateText(timestamp) {
    if (!timestamp) {
        return "";
    }

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(new Date(timestamp));

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    return values.day + "-" +
        values.month + "-" +
        values.year;
}

function getTimeText(timestamp) {
    if (!timestamp) {
        return "";
    }

    return new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).format(new Date(timestamp));
}

function normalize(game, requestedSportId) {
    const teams = getHomeAway(game);

    const home = teams.home;
    const away = teams.away;

    const competition = game.competition || {};

    const gameId = game.id != null
        ? game.id
        : game.gameId;

    if (gameId == null) {
        return null;
    }

    const timestamp = toMillis(
        game.startTime ||
        game.startTimestamp ||
        game.startDate ||
        game.date
    );

    const status = getStatus(game);

    const homeScore = getScore(home);
    const awayScore = getScore(away);

    const sportId = game.sportId != null
        ? Number(game.sportId)
        : (
            game.sport && game.sport.id != null
                ? Number(game.sport.id)
                : Number(requestedSportId)
        );

    const competitionId = Number(
        competition.id != null
            ? competition.id
            : (game.competitionId || 0)
    );

    const competitionName =
        competition.name ||
        game.competitionName ||
        game.league ||
        "";

    const homeName =
        home.name ||
        home.shortName ||
        "Home";

    const awayName =
        away.name ||
        away.shortName ||
        "Away";

    const goalEvents = getGoalEvents(game);

    const scoreText =
        status === "NS" ||
        status === "Scheduled" ||
        status === "Sched."
            ? "VS"
            : String(homeScore) + " - " + String(awayScore);

    return {
        gameId: Number(gameId),
        apiFixtureId: Number(gameId),
        apiProvider: "365scores",

        competitionId: competitionId,
        competitionName: competitionName,
        league: competitionName,

        sportId: sportId,

        homeCompetitorId: Number(home.id || 0),
        awayCompetitorId: Number(away.id || 0),

        home: homeName,
        away: awayName,

        homeTeam: homeName,
        awayTeam: awayName,

        homeLogo: getLogo(home),
        awayLogo: getLogo(away),

        homeScore: Number(homeScore || 0),
        awayScore: Number(awayScore || 0),

        score: scoreText,

        goalEvents: goalEvents,

        timestamp: timestamp,
        matchTimeMillis: timestamp,

        date: getDateText(timestamp),
        time: getTimeText(timestamp),

        status: status,
        shortStatus: status,

        round: competition.round || "",
        season: competition.season || 0,
        stadium: game.stadium || "",

        streamUrl: game.streamUrl || ""
    };
}

async function fetchMatches(options) {
    options = options || {};

    const date = options.date;
    const parserSettings = options.parserSettings || {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(
            "Invalid date. Expected YYYY-MM-DD"
        );
    }

    const baseUrl =
        parserSettings.api_url ||
        BASE_URL;

    const sportIds = Array.isArray(options.sportIds)
        ? options.sportIds
        : [1];

    if (sportIds.length === 0) {
        throw new Error(
            "No sports selected for 365Scores"
        );
    }

    const unique = Object.create(null);

    for (const sportId of sportIds) {
        try {
            const response = await axios.get(baseUrl, {
                timeout: 30000,

                params: {
                    appTypeId: 5,
                    langId: 1,
                    timezoneName: "Asia/Kolkata",
                    userCountryId: 113,
                    sports: sportId,
                    startDate: formatDate(date),
                    endDate: formatDate(date),
                    showOdds: true,
                    onlyMajorGames: false,
                    withTop: true
                },

                headers: {
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0"
                }
            });

            const data = response.data || {};

            if (!Array.isArray(data.games)) {
                throw new Error(
                    "Unexpected 365Scores response: games array missing"
                );
            }

            data.games.forEach(function (game) {
                const match = normalize(game, sportId);

                if (!match) {
                    return;
                }

                const id = String(match.gameId);
                const previous = unique[id];

                if (!previous) {
                    unique[id] = match;
                } else {
                    /*
                     * Keep existing non-empty fields if a duplicate
                     * response contains missing or empty values.
                     */
                    const merged = Object.assign({}, previous, match);

                    if (
                        Array.isArray(previous.goalEvents) &&
                        previous.goalEvents.length > 0 &&
                        (
                            !Array.isArray(match.goalEvents) ||
                            match.goalEvents.length === 0
                        )
                    ) {
                        merged.goalEvents = previous.goalEvents;
                    }

                    unique[id] = merged;
                }
            });

            console.log(
                "365Scores sport " + sportId +
                ": " + data.games.length + " games"
            );

        } catch (error) {
            console.error(
                "365Scores sport " + sportId +
                " failed: " + error.message
            );

            throw new Error(
                "365Scores fetch failed for sport " +
                sportId + ", date " + date +
                ": " + error.message
            );
        }
    }

    const matches = Object.keys(unique).map(function (id) {
        return unique[id];
    });

    console.log(
        "365Scores total for " + date +
        ": " + matches.length + " matches"
    );

    return matches;
}

module.exports = {
    fetchMatches: fetchMatches
};

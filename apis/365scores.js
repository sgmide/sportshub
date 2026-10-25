
"use strict";

var axios = require("axios");

var BASE_URL = "https://webws.365scores.com/web/games/";
var CATALOG_URL = "https://webws.365scores.com/web/sports/";
var GAME_URL = "https://webws.365scores.com/web/game/";

var TIME_ZONE = "Asia/Kolkata";
var PROVIDER_NAME = "365scores";

function toNumber(value) {
    if (value === null || value === undefined || value === "") {
        return 0;
    }

    var number = Number(value);

    return isNaN(number) ? 0 : number;
}

function toStringValue(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value);
}

function firstValue() {
    for (var i = 0; i < arguments.length; i++) {
        if (
            arguments[i] !== null &&
            arguments[i] !== undefined &&
            arguments[i] !== ""
        ) {
            return arguments[i];
        }
    }

    return "";
}

function normalizeGoalEvents(events) {
    if (!Array.isArray(events)) {
        return [];
    }

    return events.map(function (event) {
        event = event || {};

        var player = event.player || {};
        var assist = event.assist || {};
        var competitor = event.competitor || {};

        return {
            competitorId: toNumber(
                firstValue(
                    event.competitorId,
                    competitor.id,
                    event.teamId
                )
            ),

            gameTime: toStringValue(
                firstValue(
                    event.gameTime,
                    event.minute,
                    event.time
                )
            ),

            playerId: toNumber(
                firstValue(
                    event.playerId,
                    player.id,
                    event.scorerId
                )
            ),

            playerName: toStringValue(
                firstValue(
                    event.playerName,
                    player.name,
                    event.scorerName
                )
            ),

            type: toStringValue(
                firstValue(
                    event.type,
                    event.eventType,
                    event.detail
                )
            ),

            assistId: toNumber(
                firstValue(
                    event.assistId,
                    assist.id,
                    event.assistPlayerId
                )
            ),

            assistName: toStringValue(
                firstValue(
                    event.assistName,
                    assist.name,
                    event.assistPlayerName
                )
            )
        };
    });
}

function normalizeSport(sport) {
    sport = sport || {};

    return {
        id: toNumber(
            firstValue(sport.id, sport.sportId)
        ),

        name: toStringValue(
            firstValue(sport.name, sport.sportName)
        ),

        logo: toStringValue(
            firstValue(sport.logo, sport.image)
        )
    };
}

function normalizeCompetition(competition) {
    competition = competition || {};

    return {
        id: toNumber(
            firstValue(
                competition.id,
                competition.competitionId
            )
        ),

        name: toStringValue(
            firstValue(
                competition.name,
                competition.competitionName
            )
        ),

        country: toStringValue(
            firstValue(
                competition.country,
                competition.countryName
            )
        ),

        logo: toStringValue(
            firstValue(
                competition.logo,
                competition.image
            )
        )
    };
}

function normalizeMatch(game) {
    game = game || {};

    var home = game.homeCompetitor || {};
    var away = game.awayCompetitor || {};

    var competition = game.competition || {};
    var sport = game.sport || {};

    var homeScore = firstValue(
        game.homeScore,
        game.homeCompetitorScore,
        home.score
    );

    var awayScore = firstValue(
        game.awayScore,
        game.awayCompetitorScore,
        away.score
    );

    var gameDate = firstValue(
        game.startTime,
        game.startDate,
        game.date,
        game.gameTime
    );

    var status = firstValue(
        game.statusText,
        game.status,
        game.gameStatus
    );

    var match = {
        gameId: toNumber(
            firstValue(
                game.id,
                game.gameId,
                game.eventId
            )
        ),

        sportId: toNumber(
            firstValue(
                game.sportId,
                sport.id
            )
        ),

        sportName: toStringValue(
            firstValue(
                game.sportName,
                sport.name
            )
        ),

        competitionId: toNumber(
            firstValue(
                game.competitionId,
                competition.id
            )
        ),

        competition: toStringValue(
            firstValue(
                game.competitionName,
                competition.name
            )
        ),

        country: toStringValue(
            firstValue(
                game.countryName,
                game.country,
                competition.countryName
            )
        ),

        season: toStringValue(game.season),

        homeTeam: toStringValue(
            firstValue(
                game.homeCompetitorName,
                home.name,
                game.homeTeam
            )
        ),

        awayTeam: toStringValue(
            firstValue(
                game.awayCompetitorName,
                away.name,
                game.awayTeam
            )
        ),

        homeTeamId: toNumber(
            firstValue(
                game.homeCompetitorId,
                home.id
            )
        ),

        awayTeamId: toNumber(
            firstValue(
                game.awayCompetitorId,
                away.id
            )
        ),

        homeLogo: toStringValue(
            firstValue(
                game.homeCompetitorLogo,
                home.logo,
                home.image
            )
        ),

        awayLogo: toStringValue(
            firstValue(
                game.awayCompetitorLogo,
                away.logo,
                away.image
            )
        ),

        homeScore: homeScore === "" ? "" : toNumber(homeScore),

        awayScore: awayScore === "" ? "" : toNumber(awayScore),

        timestamp: toNumber(
            firstValue(
                game.startTimeSeconds,
                game.timestamp,
                game.startTimestamp
            )
        ),

        matchTimeMillis: toNumber(
            firstValue(
                game.startTimeMillis,
                game.matchTimeMillis
            )
        ),

        matchDate: toStringValue(gameDate),

        status: toStringValue(status),

        shortStatus: toStringValue(
            firstValue(
                game.statusGroup,
                game.shortStatus,
                game.statusCode
            )
        ),

        stadium: toStringValue(
            firstValue(
                game.venueName,
                game.stadiumName,
                game.venue
            )
        ),

        goalEvents: normalizeGoalEvents(
            firstValue(
                game.goalEvents,
                game.events,
                []
            )
        ),

        streamUrl: ""
    };

    if (!match.timestamp && match.matchDate) {
        var parsedDate = Date.parse(match.matchDate);

        if (!isNaN(parsedDate)) {
            match.timestamp = Math.floor(parsedDate / 1000);
            match.matchTimeMillis = parsedDate;
        }
    }

    if (!match.matchTimeMillis && match.timestamp) {
        match.matchTimeMillis = match.timestamp * 1000;
    }

    return match;
}

function getResponseData(response) {
    if (
        response &&
        response.data &&
        typeof response.data === "object"
    ) {
        return response.data;
    }

    return {};
}

async function fetchCatalog() {
    var response = await axios.get(CATALOG_URL, {
        params: {
            appTypeId: 5,
            langId: 1,
            timezoneName: TIME_ZONE
        },
        timeout: 30000
    });

    var data = getResponseData(response);

    var sports = Array.isArray(data.sports)
        ? data.sports
        : [];

    var countries = Array.isArray(data.countries)
        ? data.countries
        : [];

    var competitions = Array.isArray(data.competitions)
        ? data.competitions
        : [];

    var liveGamesCount = toNumber(
        firstValue(
            data.liveGamesCount,
            data.liveGames,
            0
        )
    );

    return {
        provider: PROVIDER_NAME,

        sports: sports.map(normalizeSport),

        countries: countries,

        competitions: competitions.map(normalizeCompetition),

        liveGamesCount: liveGamesCount
    };
}

function formatDate(date) {
    var day = String(date.getDate());
    var month = String(date.getMonth() + 1);
    var year = String(date.getFullYear());

    if (day.length < 2) {
        day = "0" + day;
    }

    if (month.length < 2) {
        month = "0" + month;
    }

    return day + "/" + month + "/" + year;
}

function getDateRange(options) {
    options = options || {};

    var startDate = options.startDate;
    var endDate = options.endDate;

    if (startDate && endDate) {
        return {
            startDate: startDate,
            endDate: endDate
        };
    }

    var now = new Date();

    var start = new Date(now.getTime());
    start.setDate(start.getDate() - 1);

    var end = new Date(now.getTime());
    end.setDate(end.getDate() + 1);

    return {
        startDate: formatDate(start),
        endDate: formatDate(end)
    };
}

async function fetchMatches(options) {
    options = options || {};

    var sportIds = Array.isArray(options.sportIds)
        ? options.sportIds
        : [];

    if (sportIds.length === 0) {
        throw new Error(
            "365Scores: No sport IDs were provided."
        );
    }

    var range = getDateRange(options);

    var allMatches = [];
    var seen = {};

    for (var i = 0; i < sportIds.length; i++) {
        var sportId = sportIds[i];

        try {
            var response = await axios.get(BASE_URL, {
                params: {
                    sports: sportId,
                    startDate: range.startDate,
                    endDate: range.endDate,
                    showOdds: true,
                    appTypeId: 5,
                    langId: 1,
                    timezoneName: TIME_ZONE
                },

                timeout: 30000
            });

            var data = getResponseData(response);

            var games = Array.isArray(data.games)
                ? data.games
                : [];

            for (var j = 0; j < games.length; j++) {
                var normalized = normalizeMatch(games[j]);

                if (!normalized.gameId) {
                    continue;
                }

                var key = String(normalized.gameId);

                if (seen[key]) {
                    continue;
                }

                seen[key] = true;
                allMatches.push(normalized);
            }
        } catch (error) {
            console.error(
                "365Scores fetch failed for sport " +
                sportId +
                ": " +
                (error.message || error)
            );
        }
    }

    return allMatches;
}

async function fetchGameDetails(gameId) {
    if (!gameId) {
        throw new Error(
            "365Scores: gameId is required."
        );
    }

    var response = await axios.get(GAME_URL, {
        params: {
            gameId: gameId,
            appTypeId: 5,
            langId: 1,
            timezoneName: TIME_ZONE
        },

        timeout: 30000
    });

    var data = getResponseData(response);

    var game = data.game || data;

    return normalizeMatch(game);
}

module.exports = {
    providerName: PROVIDER_NAME,

    fetchCatalog: fetchCatalog,

    fetchMatches: fetchMatches,

    fetchGameDetails: fetchGameDetails,

    normalizeMatch: normalizeMatch,

    normalizeSport: normalizeSport,

    normalizeCompetition: normalizeCompetition,

    normalizeGoalEvents: normalizeGoalEvents
};

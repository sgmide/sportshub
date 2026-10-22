"use strict";

const admin = require("firebase-admin");
const axios = require("axios");

const PROVIDER = "365scores";
const API_URL = "https://webws.365scores.com/web/games/";
const IMAGE_URL =
    "https://imagecache.365scores.com/image/upload/";

const TIME_ZONE = "Asia/Kolkata";
const DATE_RANGE = 1;

const FIREBASE_SERVICE_ACCOUNT =
    process.env.FIREBASE_SERVICE_ACCOUNT;

const FIREBASE_DATABASE_URL =
    process.env.FIREBASE_DATABASE_URL;

let db;

/* -------------------- HELPERS -------------------- */

function cleanKey(value) {
    return String(value == null ? "" : value)
        .trim()
        .replace(/[.#$/\[\]]/g, "_");
}

function normalizeText(value) {
    return String(value == null ? "" : value)
        .trim()
        .toLowerCase();
}

function normalizeBoolean(value) {
    if (value === true || value === 1) {
        return true;
    }

    if (typeof value === "string") {
        return value.trim().toLowerCase() === "true" ||
            value.trim() === "1";
    }

    if (value && typeof value === "object") {
        if (Object.prototype.hasOwnProperty.call(value, "selected")) {
            return normalizeBoolean(value.selected);
        }

        if (Object.prototype.hasOwnProperty.call(value, "enabled")) {
            return normalizeBoolean(value.enabled);
        }

        return false;
    }

    return false;
}

function getSelectedParser(settings) {
    return String(settings.selected_parser || "parse1").trim();
}

function getApiParser(settings) {
    const parserKey = getSelectedParser(settings);

    const parserConfig =
        settings.parse && settings.parse[parserKey]
            ? settings.parse[parserKey]
            : {};

    return {
        parserKey: parserKey,
        apiParser: normalizeText(parserConfig.api_parser),
        parserConfig: parserConfig
    };
}

function is365ScoresParser(settings) {
    const selected = getApiParser(settings);

    return selected.apiParser === "365" ||
        selected.apiParser === "365scores";
}

function getTimestamp(value) {
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

function getImageUrl(imageId) {
    if (!imageId) {
        return "";
    }

    const value = String(imageId).trim();

    if (value.startsWith("http://") ||
        value.startsWith("https://")) {
        return value;
    }

    return IMAGE_URL + value;
}

function getDateString(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(date);

    const day = parts.find(p => p.type === "day").value;
    const month = parts.find(p => p.type === "month").value;
    const year = parts.find(p => p.type === "year").value;

    return day + "/" + month + "/" + year;
}

function getDateRange() {
    const now = new Date();

    const yesterday = new Date(now.getTime());
    yesterday.setUTCDate(yesterday.getUTCDate() - DATE_RANGE);

    const tomorrow = new Date(now.getTime());
    tomorrow.setUTCDate(tomorrow.getUTCDate() + DATE_RANGE);

    return {
        startDate: getDateString(yesterday),
        endDate: getDateString(tomorrow)
    };
}

function getObjectId(object, keys) {
    if (!object || typeof object !== "object") {
        return "";
    }

    for (const key of keys) {
        if (object[key] != null && object[key] !== "") {
            return String(object[key]);
        }
    }

    return "";
}

function getNestedObject(object, keys) {
    if (!object || typeof object !== "object") {
        return {};
    }

    for (const key of keys) {
        if (object[key] && typeof object[key] === "object") {
            return object[key];
        }
    }

    return {};
}

function getTeamName(team) {
    if (!team) {
        return "";
    }

    if (typeof team === "string") {
        return team;
    }

    return team.name ||
        team.shortName ||
        team.fullName ||
        "";
}

function getTeamLogo(team) {
    if (!team || typeof team !== "object") {
        return "";
    }

    return getImageUrl(
        team.logo ||
        team.image ||
        team.imageId ||
        team.logoId ||
        ""
    );
}

function getScore(game, side) {
    const directKeys = side === "home"
        ? ["homeScore", "homeGoals", "scoreHome"]
        : ["awayScore", "awayGoals", "scoreAway"];

    for (const key of directKeys) {
        if (game[key] != null && game[key] !== "") {
            const number = Number(game[key]);

            return Number.isFinite(number) ? number : 0;
        }
    }

    const scoreObject = game.scores || game.score || {};

    const possible = side === "home"
        ? ["home", "homeScore", "homeGoals"]
        : ["away", "awayScore", "awayGoals"];

    for (const key of possible) {
        if (scoreObject[key] != null) {
            const value = scoreObject[key];

            if (typeof value === "object") {
                const number = Number(
                    value.current != null
                        ? value.current
                        : value.score
                );

                return Number.isFinite(number) ? number : 0;
            }

            const number = Number(value);

            return Number.isFinite(number) ? number : 0;
        }
    }

    return 0;
}

function getStatus(game) {
    const statusObject = getNestedObject(game, [
        "status",
        "gameStatus"
    ]);

    const rawStatus =
        (typeof game.status === "string" ? game.status : "") ||
        statusObject.shortName ||
        statusObject.name ||
        game.statusText ||
        game.statusGroup ||
        "";

    const status = String(rawStatus).trim().toUpperCase();

    if (status.indexOf("FINISHED") !== -1 ||
        status === "FT" ||
        status === "AET" ||
        status === "PEN") {
        return "FT";
    }

    if (status.indexOf("POSTPONED") !== -1 ||
        status === "PPD") {
        return "PPD";
    }

    if (status.indexOf("CANCEL") !== -1 ||
        status === "CANC") {
        return "CANC";
    }

    if (status.indexOf("ABANDON") !== -1 ||
        status === "ABD") {
        return "ABD";
    }

    if (status.indexOf("LIVE") !== -1 ||
        status.indexOf("IN PROGRESS") !== -1 ||
        status.indexOf("HALF TIME") !== -1 ||
        /^[0-9]{1,3}'$/.test(status)) {
        return "LIVE";
    }

    return status || "NS";
}

function getCompetitionId(game) {
    const competition = getNestedObject(game, [
        "competition",
        "league",
        "tournament"
    ]);

    return getObjectId(game, [
        "competitionId",
        "leagueId",
        "tournamentId"
    ]) || getObjectId(competition, [
        "id",
        "competitionId",
        "leagueId"
    ]);
}

function getSportId(game) {
    const sport = getNestedObject(game, ["sport"]);

    return getObjectId(game, [
        "sportId"
    ]) || getObjectId(sport, ["id"]);
}

function getCompetitionName(game) {
    const competition = getNestedObject(game, [
        "competition",
        "league",
        "tournament"
    ]);

    return game.competitionName ||
        game.leagueName ||
        game.tournamentName ||
        competition.name ||
        competition.shortName ||
        "";
}

function getSportName(game) {
    const sport = getNestedObject(game, ["sport"]);

    return game.sportName ||
        sport.name ||
        "";
}

function getFixtureId(game) {
    return getObjectId(game, [
        "id",
        "gameId",
        "fixtureId"
    ]);
}

function getKickoff(game) {
    const possible = [
        game.startTime,
        game.startDate,
        game.date,
        game.kickoff,
        game.gameTime
    ];

    for (const value of possible) {
        const timestamp = getTimestamp(value);

        if (timestamp > 0) {
            return timestamp;
        }
    }

    return 0;
}

/* -------------------- HTTP -------------------- */

async function apiGet(params, parserConfig) {
    const configuredUrl =
        parserConfig && parserConfig.api_url
            ? String(parserConfig.api_url).trim()
            : "";

    const url = configuredUrl || API_URL;

    const response = await axios.get(url, {
        params: params,
        timeout: 30000,
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json"
        }
    });

    if (!response || response.status < 200 ||
        response.status >= 300) {
        throw new Error("365Scores API returned an unsuccessful response.");
    }

    return response.data || {};
}

/* -------------------- SELECTION -------------------- */

async function loadCompetitionSelections() {
    const snapshot = await db
        .ref("competition_selection")
        .once("value");

    const data = snapshot.val() || {};
    const selected = new Set();

    Object.keys(data).forEach(function (key) {
        if (normalizeBoolean(data[key])) {
            selected.add(String(key));
        }
    });

    console.log(
        "Selected competitions:",
        selected.size
    );

    return selected;
}

function isCompetitionSelected(
    competitionId,
    selectedCompetitions
) {
    if (!competitionId) {
        return false;
    }

    return selectedCompetitions.has(String(competitionId));
}

/* -------------------- GAME RESPONSE -------------------- */

function extractGames(data) {
    if (Array.isArray(data.games)) {
        return data.games;
    }

    if (Array.isArray(data.events)) {
        return data.events;
    }

    if (Array.isArray(data.gamesList)) {
        return data.gamesList;
    }

    if (data.data && Array.isArray(data.data.games)) {
        return data.data.games;
    }

    if (data.response && Array.isArray(data.response.games)) {
        return data.response.games;
    }

    return [];
}

function getGameTeams(game) {
    const home = getNestedObject(game, [
        "homeCompetitor",
        "homeTeam",
        "home"
    ]);

    const away = getNestedObject(game, [
        "awayCompetitor",
        "awayTeam",
        "away"
    ]);

    return {
        home: home,
        away: away
    };
}

function convertGame(game, existingMatch) {
    const fixtureId = getFixtureId(game);

    if (!fixtureId) {
        return null;
    }

    const teams = getGameTeams(game);

    const homeTeam = getTeamName(teams.home) ||
        game.homeCompetitorName ||
        game.homeTeamName ||
        "";

    const awayTeam = getTeamName(teams.away) ||
        game.awayCompetitorName ||
        game.awayTeamName ||
        "";

    const competitionId = getCompetitionId(game);
    const sportId = getSportId(game);
    const kickoff = getKickoff(game);

    const homeScore = getScore(game, "home");
    const awayScore = getScore(game, "away");

    const status = getStatus(game);

    const match = {
        gameId: fixtureId,
        apiFixtureId: fixtureId,
        apiProvider: PROVIDER,

        sportId: sportId,
        sportName: getSportName(game),

        competitionId: competitionId,
        competitionName: getCompetitionName(game),

        homeTeam: homeTeam,
        awayTeam: awayTeam,

        homeScore: homeScore,
        awayScore: awayScore,

        homeLogo: getTeamLogo(teams.home) ||
            (existingMatch && existingMatch.homeLogo) ||
            "",

        awayLogo: getTeamLogo(teams.away) ||
            (existingMatch && existingMatch.awayLogo) ||
            "",

        timestamp: kickoff,
        matchTimeMillis: kickoff,

        status: status,
        shortStatus: status,

        competitionSelected: true,

        updatedAt: Date.now()
    };

    /*
     * Preserve admin-managed values from existing records.
     */
    const preservedFields = [
        "streamUrl",
        "goalEvents",
        "adminNotes",
        "stadium",
        "channels",
        "homeLogo",
        "awayLogo"
    ];

    preservedFields.forEach(function (field) {
        if (existingMatch &&
            existingMatch[field] != null &&
            existingMatch[field] !== "") {
            if (field === "channels" ||
                field === "goalEvents") {
                match[field] = existingMatch[field];
            } else if (field === "streamUrl" ||
                field === "adminNotes" ||
                field === "stadium") {
                match[field] = existingMatch[field];
            } else if (!match[field]) {
                match[field] = existingMatch[field];
            }
        }
    });

    return match;
}

/* -------------------- MAIN SYNC -------------------- */

async function main() {
    if (!FIREBASE_SERVICE_ACCOUNT ||
        !FIREBASE_DATABASE_URL) {
        throw new Error(
            "Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL secret."
        );
    }

    const serviceAccount =
        JSON.parse(FIREBASE_SERVICE_ACCOUNT);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: FIREBASE_DATABASE_URL
    });

    db = admin.database();

    try {
        const settingsSnapshot = await db
            .ref("settings")
            .once("value");

        const settings = settingsSnapshot.val() || {};

        const parserInfo = getApiParser(settings);

        if (!is365ScoresParser(settings)) {
            console.log(
                "Skipping 365Scores. Selected API:",
                parserInfo.apiParser || "(not configured)"
            );
            return;
        }

        console.log("Selected parser:", parserInfo.parserKey);
        console.log("Selected API:", PROVIDER);

        /*
         * Read selections before fetching or writing match records.
         */
        const selectedCompetitions =
            await loadCompetitionSelections();

        if (selectedCompetitions.size === 0) {
            console.log(
                "No competitions selected. No matches will be saved."
            );
            return;
        }

        const selectedSports = getSelectedSports(settings);

        if (selectedSports.length === 0) {
            throw new Error(
                "No sports configured in settings.selected_sports or settings.selected_sport."
            );
        }

        const dateRange = getDateRange();

        console.log("Date range:", dateRange.startDate,
            "to", dateRange.endDate);

        /*
         * Fetch all requested sports first.
         * Do not write or delete match data if any API request fails.
         */
        const allGames = [];
        const seenGames = new Set();

        for (const sportId of selectedSports) {
            console.log("Fetching sport:", sportId);

            const data = await apiGet({
                startDate: dateRange.startDate,
                endDate: dateRange.endDate,
                timezoneName: TIME_ZONE,
                sportId: sportId,
                onlyMajorGames: false
            }, parserInfo.parserConfig);

            const games = extractGames(data);

            console.log(
                "Games received for sport",
                sportId + ":",
                games.length
            );

            games.forEach(function (game) {
                const id = getFixtureId(game);

                if (!id) {
                    return;
                }

                const key = String(id);

                if (!seenGames.has(key)) {
                    seenGames.add(key);
                    allGames.push(game);
                }
            });
        }

        console.log("Total unique games received:", allGames.length);

        /*
         * Only selected competitions are included in matchUpdates.
         */
        const selectedGames = [];

        allGames.forEach(function (game) {
            const competitionId = getCompetitionId(game);

            if (isCompetitionSelected(
                competitionId,
                selectedCompetitions
            )) {
                selectedGames.push(game);
            }
        });

        console.log(
            "Games in selected competitions:",
            selectedGames.length
        );

        /*
         * Avoid wiping old records if the API unexpectedly returns
         * no games. No provider cleanup is performed in that case.
         */
        if (allGames.length === 0) {
            throw new Error(
                "365Scores returned zero games. Existing Firebase matches were left unchanged."
            );
        }

        if (selectedGames.length === 0) {
            console.log(
                "No games matched selected competitions. Existing Firebase matches were left unchanged."
            );
            return;
        }

        const existingSnapshot = await db
            .ref("matches")
            .once("value");

        const existingMatches = existingSnapshot.val() || {};

        const matchUpdates = {};
        const selectedKeys = new Set();

        selectedGames.forEach(function (game) {
            const fixtureId = getFixtureId(game);

            if (!fixtureId) {
                return;
            }

            const key = cleanKey(fixtureId);
            const oldMatch = existingMatches[key] || {};

            const converted = convertGame(game, oldMatch);

            if (!converted) {
                return;
            }

            matchUpdates[key] = converted;
            selectedKeys.add(key);
        });

        if (Object.keys(matchUpdates).length === 0) {
            throw new Error(
                "No valid selected matches could be prepared. Existing data was left unchanged."
            );
        }

        /*
         * One atomic update for the selected matches.
         */
        await db.ref("matches").update(matchUpdates);

        console.log(
            "Saved selected matches:",
            Object.keys(matchUpdates).length
        );

        /*
         * Provider cleanup happens only after successful fetch and write.
         * Never delete a record that was just saved by 365Scores.
         */
        const currentProviderSnapshot = await db
            .ref("syncSettings/currentProvider")
            .once("value");

        const previousProvider =
            normalizeText(currentProviderSnapshot.val());

        if (previousProvider === "apifootball" ||
            previousProvider === "api-football" ||
            previousProvider === "football") {

            const cleanupUpdates = {};

            Object.keys(existingMatches).forEach(function (key) {
                const match = existingMatches[key] || {};

                const oldProvider =
                    normalizeText(match.apiProvider);

                const isOldFootballRecord =
                    oldProvider === "apifootball" &&
                    String(match.sportId) === "1";

                if (isOldFootballRecord &&
                    !selectedKeys.has(key)) {
                    cleanupUpdates[key] = null;
                }
            });

            if (Object.keys(cleanupUpdates).length > 0) {
                await db.ref("matches").update(cleanupUpdates);

                console.log(
                    "Removed old API-Football records:",
                    Object.keys(cleanupUpdates).length
                );
            }
        }

        /*
         * Update provider marker only after successful match sync.
         */
        await db.ref("syncSettings").update({
            currentProvider: PROVIDER,
            lastSuccessfulSync: Date.now(),
            lastSyncStatus: "success",
            lastSyncMatches: Object.keys(matchUpdates).length
        });

        console.log("365Scores sync completed successfully.");

    } finally {
        await admin.app().delete();
    }
}

/* -------------------- SELECTED SPORTS -------------------- */

function getSelectedSports(settings) {
    const selected = [];

    if (Array.isArray(settings.selected_sports)) {
        settings.selected_sports.forEach(function (item) {
            if (item != null && item !== "") {
                if (typeof item === "object") {
                    const id = item.id != null
                        ? item.id
                        : item.sportId;

                    if (id != null && id !== "") {
                        selected.push(String(id));
                    }
                } else {
                    selected.push(String(item));
                }
            }
        });
    } else if (settings.selected_sports &&
        typeof settings.selected_sports === "object") {

        Object.keys(settings.selected_sports).forEach(function (key) {
            if (normalizeBoolean(settings.selected_sports[key])) {
                selected.push(String(key));
            }
        });
    }

    if (selected.length === 0 &&
        settings.selected_sport != null &&
        settings.selected_sport !== "") {
        selected.push(String(settings.selected_sport));
    }

    return Array.from(new Set(selected));
}

/* -------------------- RUN -------------------- */

main().catch(function (error) {
    console.error(
        "365Scores sync failed:",
        error && error.message ? error.message : error
    );

    process.exitCode = 1;
});

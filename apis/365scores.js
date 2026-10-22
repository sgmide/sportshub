"use strict";

const admin = require("firebase-admin");
const axios = require("axios");

const PROVIDER = "365scores";

const API_URL =
    "https://webws.365scores.com/web/games/";

const IMAGE_URL =
    "https://imagecache.365scores.com/image/upload/";

const TIME_ZONE = "Asia/Kolkata";
const DATE_RANGE = 1;

const REQUEST_TIMEOUT = 30000;
const REQUEST_DELAY = 500;

const FIREBASE_SERVICE_ACCOUNT =
    process.env.FIREBASE_SERVICE_ACCOUNT;

const FIREBASE_DATABASE_URL =
    process.env.FIREBASE_DATABASE_URL;

const API_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.365scores.com/"
};

const DEFAULT_SPORTS = {
    "01": {
        id: 1,
        name: "Football"
    },
    "02": {
        id: 2,
        name: "Basketball"
    },
    "03": {
        id: 3,
        name: "Tennis"
    },
    "04": {
        id: 4,
        name: "Hockey"
    },
    "05": {
        id: 5,
        name: "Handball"
    },
    "06": {
        id: 6,
        name: "A. Football"
    },
    "07": {
        id: 7,
        name: "Baseball"
    },
    "08": {
        id: 8,
        name: "Volleyball"
    },
    "09": {
        id: 9,
        name: "Rugby"
    }
};

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function cleanKey(value) {
    return String(value == null ? "" : value)
        .trim()
        .replace(/[.#$\[\]/]/g, "_");
}

function normalizeText(value) {
    if (value == null) {
        return "";
    }

    return String(value).trim();
}

function normalizeBoolean(value, fallback) {
    if (value === true || value === false) {
        return value;
    }

    if (typeof value === "string") {
        const v = value.toLowerCase().trim();

        if (v === "true" || v === "1" || v === "yes") {
            return true;
        }

        if (v === "false" || v === "0" || v === "no") {
            return false;
        }
    }

    return fallback;
}

function getTimestamp() {
    return Date.now();
}

function getDateString(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    let year = "";
    let month = "";
    let day = "";

    parts.forEach(function (part) {
        if (part.type === "year") {
            year = part.value;
        } else if (part.type === "month") {
            month = part.value;
        } else if (part.type === "day") {
            day = part.value;
        }
    });

    return year + "-" + month + "-" + day;
}

function getDateRange() {
    const dates = [];
    const today = getDateString(new Date());

    const base = new Date(today + "T12:00:00Z");

    for (let i = -DATE_RANGE; i <= DATE_RANGE; i++) {
        const d = new Date(
            base.getTime() + i * 86400000
        );

        dates.push(getDateString(d));
    }

    return dates;
}

function getNestedObject(obj, path) {
    let current = obj;

    for (let i = 0; i < path.length; i++) {
        if (
            current == null ||
            typeof current !== "object"
        ) {
            return null;
        }

        current = current[path[i]];
    }

    return current == null ? null : current;
}

function getObjectId(obj) {
    if (obj == null) {
        return "";
    }

    if (typeof obj !== "object") {
        return normalizeText(obj);
    }

    return normalizeText(
        obj.id ||
        obj.ID ||
        obj.competitorId ||
        obj.competitionId ||
        obj.sportId ||
        obj.gameId ||
        obj.teamId ||
        obj.value ||
        ""
    );
}

function getName(obj) {
    if (obj == null) {
        return "";
    }

    if (typeof obj !== "object") {
        return normalizeText(obj);
    }

    return normalizeText(
        obj.name ||
        obj.shortName ||
        obj.longName ||
        obj.displayName ||
        obj.title ||
        obj.value ||
        ""
    );
}

function getTeamName(team) {
    return getName(team);
}

function getTeamLogo(team) {
    if (!team || typeof team !== "object") {
        return "";
    }

    const direct =
        team.logo ||
        team.image ||
        team.imageUrl ||
        team.logoUrl ||
        team.picture ||
        team.pictureUrl ||
        "";

    if (direct) {
        return normalizeText(direct);
    }

    const imageId =
        team.imageID ||
        team.imageId ||
        team.logoId ||
        team.pictureId ||
        "";

    if (imageId) {
        return IMAGE_URL + String(imageId);
    }

    return "";
}

function getScore(game, side) {
    const names = side === "home"
        ? ["homeCompetitor", "homeTeam", "home"]
        : ["awayCompetitor", "awayTeam", "away"];

    for (let i = 0; i < names.length; i++) {
        const team = game[names[i]];

        if (team && typeof team === "object") {
            const value =
                team.score != null
                    ? team.score
                    : team.currentScore;

            if (value != null) {
                return normalizeText(value);
            }
        }
    }

    const candidates = side === "home"
        ? [
            game.homeScore,
            game.home_score,
            game.scoreHome
        ]
        : [
            game.awayScore,
            game.away_score,
            game.scoreAway
        ];

    for (let j = 0; j < candidates.length; j++) {
        if (candidates[j] != null) {
            return normalizeText(candidates[j]);
        }
    }

    return "";
}

function getStatus(game) {
    const statusObj =
        game.status ||
        game.gameStatus ||
        game.statusText ||
        "";

    if (typeof statusObj === "object") {
        return normalizeText(
            statusObj.shortName ||
            statusObj.name ||
            statusObj.text ||
            statusObj.value ||
            ""
        );
    }

    if (statusObj) {
        return normalizeText(statusObj);
    }

    const phase =
        game.gameTime ||
        game.clock ||
        game.phase ||
        "";

    if (phase) {
        return normalizeText(phase);
    }

    return "NS";
}

function getCompetition(game) {
    return (
        game.competition ||
        game.tournament ||
        game.league ||
        game.competitionObj ||
        {}
    );
}

function getCompetitionId(game) {
    const comp = getCompetition(game);

    const value =
        game.competitionId ||
        game.tournamentId ||
        game.leagueId ||
        getObjectId(comp);

    return normalizeText(value);
}

function getCompetitionName(game) {
    const comp = getCompetition(game);

    return (
        getName(comp) ||
        normalizeText(
            game.competitionName ||
            game.tournamentName ||
            game.leagueName ||
            ""
        )
    );
}

function getSport(game) {
    return (
        game.sport ||
        game.sportObj ||
        game.sportType ||
        {}
    );
}

function getSportId(game) {
    const sport = getSport(game);

    return normalizeText(
        game.sportId ||
        game.sportTypeId ||
        getObjectId(sport)
    );
}

function getSportName(game) {
    const sport = getSport(game);

    return (
        getName(sport) ||
        normalizeText(game.sportName || "")
    );
}

function getFixtureId(game) {
    return normalizeText(
        game.id ||
        game.gameId ||
        game.gameID ||
        game.fixtureId ||
        game.eventId ||
        ""
    );
}

function getKickoff(game) {
    const values = [
        game.startTime,
        game.startDate,
        game.startDateTime,
        game.dateTime,
        game.gameDate,
        game.kickoff,
        game.date
    ];

    for (let i = 0; i < values.length; i++) {
        const value = values[i];

        if (value == null || value === "") {
            continue;
        }

        if (typeof value === "number") {
            const ms = value < 1000000000000
                ? value * 1000
                : value;

            const date = new Date(ms);

            if (!isNaN(date.getTime())) {
                return date;
            }
        }

        const date = new Date(value);

        if (!isNaN(date.getTime())) {
            return date;
        }
    }

    return null;
}

function getGameTeams(game) {
    const home =
        game.homeCompetitor ||
        game.homeTeam ||
        game.home ||
        {};

    const away =
        game.awayCompetitor ||
        game.awayTeam ||
        game.away ||
        {};

    return {
        home: home,
        away: away
    };
}

function getSelectedParser(settings) {
    return normalizeText(
        getNestedObject(settings, [
            "selected_parser"
        ]) || "parse1"
    );
}

function getApiParser(settings) {
    const selected = getSelectedParser(settings);

    return normalizeText(
        getNestedObject(settings, [
            "parse",
            selected,
            "api_parser"
        ]) || ""
    ).toLowerCase();
}

function is365ScoresParser(settings) {
    const parser = getApiParser(settings);

    return (
        parser === "365" ||
        parser === "365scores" ||
        parser === "365-scores"
    );
}

function getSelectedSports(settings) {
    const list = settings.selected_sports;

    if (Array.isArray(list)) {
        const hasBoolean = list.some(function (v) {
            return typeof v === "boolean";
        });

        if (hasBoolean) {
            const ids = [];

            list.forEach(function (value, index) {
                if (value === true) {
                    ids.push(String(index));
                }
            });

            return ids;
        }

        return list
            .filter(function (v) {
                return v != null && v !== false;
            })
            .map(function (v) {
                return String(v);
            });
    }

    if (list && typeof list === "object") {
        return Object.keys(list).filter(function (key) {
            return normalizeBoolean(list[key], false);
        });
    }

    const selectedSport = settings.selected_sport;

    if (
        selectedSport != null &&
        selectedSport !== ""
    ) {
        return [String(selectedSport)];
    }

    return [];
}

function isSportSelected(game, selectedSports) {
    if (!selectedSports || selectedSports.length === 0) {
        return true;
    }

    const id = getSportId(game);

    if (!id) {
        return false;
    }

    return selectedSports.indexOf(String(id)) !== -1;
}

async function apiGet(date) {
    const response = await axios.get(API_URL, {
        timeout: REQUEST_TIMEOUT,
        headers: API_HEADERS,
        params: {
            startDate: date,
            endDate: date,
            lang: "en",
            timezoneName: TIME_ZONE
        }
    });

    if (
        !response ||
        response.status < 200 ||
        response.status >= 300
    ) {
        throw new Error(
            "365Scores API returned an unsuccessful response."
        );
    }

    return response.data;
}

function extractGames(data) {
    if (Array.isArray(data)) {
        return data;
    }

    if (!data || typeof data !== "object") {
        return [];
    }

    const possibleArrays = [
        data.games,
        data.events,
        data.fixtures,
        data.results,
        data.data,
        getNestedObject(data, ["games", "items"]),
        getNestedObject(data, ["data", "games"]),
        getNestedObject(data, ["data", "events"])
    ];

    for (let i = 0; i < possibleArrays.length; i++) {
        if (Array.isArray(possibleArrays[i])) {
            return possibleArrays[i];
        }
    }

    return [];
}

function convertGame(game, existingMatch) {
    const teams = getGameTeams(game);

    const homeName = getTeamName(teams.home);
    const awayName = getTeamName(teams.away);

    const gameId = getFixtureId(game);
    const competitionId = getCompetitionId(game);
    const competitionName = getCompetitionName(game);
    const sportId = getSportId(game);

    const kickoff = getKickoff(game);

    if (!gameId || !homeName || !awayName) {
        return null;
    }

    const homeScore = getScore(game, "home");
    const awayScore = getScore(game, "away");

    let score = "-";

    if (homeScore !== "" || awayScore !== "") {
        score =
            (homeScore === "" ? "0" : homeScore) +
            " - " +
            (awayScore === "" ? "0" : awayScore);
    }

    const status = getStatus(game);

    const date = kickoff
        ? getDateString(kickoff)
        : "";

    let time = "";

    if (kickoff) {
        time = new Intl.DateTimeFormat("en-GB", {
            timeZone: TIME_ZONE,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).format(kickoff);
    }

    const old = existingMatch || {};

    const homeLogo =
        getTeamLogo(teams.home) ||
        old.homeLogo ||
        "";

    const awayLogo =
        getTeamLogo(teams.away) ||
        old.awayLogo ||
        "";

    /*
     * Start from the existing record to preserve admin fields:
     * streamUrl, goalEvents, stadium, channels, adminNotes, etc.
     */
    const match = Object.assign({}, old, {
        gameId: gameId,
        apiFixtureId: gameId,
        apiProvider: PROVIDER,

        competitionId: competitionId,
        sportId: sportId,

        home: homeName,
        away: awayName,

        homeLogo: homeLogo,
        awayLogo: awayLogo,

        league:
            competitionName ||
            old.league ||
            "Unknown Competition",

        date: date || old.date || "",
        time: time || old.time || "",

        score: score === "-" && old.score
            ? old.score
            : score,

        status: status || old.status || "NS",
        shortStatus: status || old.shortStatus || "NS",

        timestamp: kickoff
            ? kickoff.getTime()
            : (old.timestamp || getTimestamp()),

        matchTimeMillis: kickoff
            ? kickoff.getTime()
            : (old.matchTimeMillis || 0)
    });

    return {
        id: gameId,
        competitionId: competitionId,
        competitionName: competitionName,
        sportId: sportId,
        sportName: getSportName(game),
        match: match
    };
}

function getFirebaseAdmin() {
    if (!FIREBASE_SERVICE_ACCOUNT) {
        throw new Error(
            "Missing FIREBASE_SERVICE_ACCOUNT secret."
        );
    }

    if (!FIREBASE_DATABASE_URL) {
        throw new Error(
            "Missing FIREBASE_DATABASE_URL secret."
        );
    }

    if (!admin.apps.length) {
        let serviceAccount;

        try {
            serviceAccount = JSON.parse(
                FIREBASE_SERVICE_ACCOUNT
            );
        } catch (error) {
            throw new Error(
                "FIREBASE_SERVICE_ACCOUNT is not valid JSON."
            );
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: FIREBASE_DATABASE_URL
        });
    }

    return admin.database();
}

async function ensureBaseNodes(db) {
    const rootRef = db.ref();

    const snapshot = await rootRef.once("value");
    const root = snapshot.val() || {};

    const updates = {};

    /*
     * Create settings only if absent.
     * Never replace an existing settings node.
     */
    if (
        !root.settings ||
        typeof root.settings !== "object"
    ) {
        updates["settings"] = {
            selected_parser: "parse1",
            selected_sport: 1,
            selected_sports: [null, true],
            parse: {
                parse1: {
                    api_parser: "365",
                    api_url: API_URL,
                    game_api_url:
                        "https://webws.365scores.com/web/game/?gameId={gameId}"
                }
            }
        };
    } else {
        const settings = root.settings;

        if (!settings.selected_parser) {
            updates["settings/selected_parser"] = "parse1";
        }

        const parserName = settings.selected_parser || "parse1";

        if (
            !settings.parse ||
            typeof settings.parse !== "object"
        ) {
            updates["settings/parse"] = {};
        }

        const parserSettings =
            settings.parse &&
            settings.parse[parserName];

        if (
            !parserSettings ||
            typeof parserSettings !== "object"
        ) {
            updates["settings/parse/" + parserName] = {
                api_parser: "365",
                api_url: API_URL,
                game_api_url:
                    "https://webws.365scores.com/web/game/?gameId={gameId}"
            };
        } else {
            if (!parserSettings.api_parser) {
                updates[
                    "settings/parse/" +
                    parserName +
                    "/api_parser"
                ] = "365";
            }

            if (!parserSettings.api_url) {
                updates[
                    "settings/parse/" +
                    parserName +
                    "/api_url"
                ] = API_URL;
            }
        }
    }

    /*
     * Create sports node only if absent.
     * Existing sports entries are never overwritten.
     */
    if (
        !root.sports ||
        typeof root.sports !== "object"
    ) {
        updates["sports"] = DEFAULT_SPORTS;
    }

    if (
        !root.competitions ||
        typeof root.competitions !== "object"
    ) {
        updates["competitions"] = {};
    }

    if (
        !root.competition_selection ||
        typeof root.competition_selection !== "object"
    ) {
        updates["competition_selection"] = {};
    }

    if (
        !root.matches ||
        typeof root.matches !== "object"
    ) {
        updates["matches"] = {};
    }

    if (
        !root.syncSettings ||
        typeof root.syncSettings !== "object"
    ) {
        updates["syncSettings"] = {
            autoSyncEnabled: true,
            syncIntervalMinutes: 5,
            lastSuccessfulSync: 0
        };
    }

    if (Object.keys(updates).length > 0) {
        await rootRef.update(updates);
        console.log(
            "Created missing Firebase nodes:",
            Object.keys(updates).join(", ")
        );
    }

    const settingsSnapshot =
        await db.ref("settings").once("value");

    return settingsSnapshot.val() || {};
}

async function loadCompetitionSelections(db) {
    const snapshot = await db
        .ref("competition_selection")
        .once("value");

    const data = snapshot.val() || {};
    const selections = {};

    Object.keys(data).forEach(function (id) {
        selections[String(id)] = normalizeBoolean(
            data[id],
            false
        );
    });

    return selections;
}

function isCompetitionSelected(
    competitionId,
    selections,
    competitions
) {
    const id = String(competitionId || "");

    if (!id) {
        return false;
    }

    if (
        Object.prototype.hasOwnProperty.call(
            selections,
            id
        )
    ) {
        return selections[id] === true;
    }

    const competition =
        competitions &&
        competitions[id];

    if (competition) {
        return normalizeBoolean(
            competition.selected,
            false
        );
    }

    return false;
}

async function ensureCompetitionRecords(db, records) {
    const compRef = db.ref("competitions");
    const selectionRef = db.ref("competition_selection");

    const compSnapshot = await compRef.once("value");
    const selectionSnapshot = await selectionRef.once("value");

    const existingCompetitions = compSnapshot.val() || {};
    const existingSelections = selectionSnapshot.val() || {};

    const updates = {};

    records.forEach(function (record) {
        const id = cleanKey(record.competitionId);

        if (!id) {
            return;
        }

        const old =
            existingCompetitions[id] || {};

        const selected = normalizeBoolean(
            old.selected,
            normalizeBoolean(
                existingSelections[id],
                false
            )
        );

        const comp = Object.assign({}, old, {
            id: record.competitionId,
            name:
                record.competitionName ||
                old.name ||
                "Unknown Competition",
            selected: selected,
            sportId:
                record.sportId ||
                old.sportId ||
                ""
        });

        updates["competitions/" + id] = comp;

        /*
         * Only initialize a missing selection.
         * Never overwrite a user's true/false choice.
         */
        if (
            !Object.prototype.hasOwnProperty.call(
                existingSelections,
                id
            )
        ) {
            updates["competition_selection/" + id] =
                selected;
        }
    });

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    }

    const freshCompetitions = await compRef.once("value");
    const freshSelections = await selectionRef.once("value");

    return {
        competitions: freshCompetitions.val() || {},
        selections: freshSelections.val() || {}
    };
}

async function ensureNewSports(db, records) {
    const snapshot = await db.ref("sports").once("value");
    const sports = snapshot.val() || {};
    const updates = {};

    records.forEach(function (record) {
        const sportId = normalizeText(record.sportId);
        const sportName = normalizeText(record.sportName);

        if (!sportId || !sportName) {
            return;
        }

        /*
         * Do not invent/replace existing sport IDs.
         * Use a zero-padded key for a genuinely missing sport.
         */
        const key = sportId.length < 2
            ? "0" + sportId
            : sportId;

        if (
            !Object.prototype.hasOwnProperty.call(
                sports,
                key
            )
        ) {
            updates["sports/" + key] = {
                id: sportId,
                name: sportName
            };
        }
    });

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    }
}

async function main() {
    console.log("====================================");
    console.log("Sports Hub 365Scores Sync");
    console.log("====================================");

    const db = getFirebaseAdmin();

    const settings = await ensureBaseNodes(db);

    if (!is365ScoresParser(settings)) {
        console.log(
            "Warning: settings parser is not configured as 365Scores."
        );

        console.log(
            "The script will continue using the 365Scores endpoint."
        );
    }

    const selectedSports = getSelectedSports(settings);

    console.log(
        "Selected sports:",
        selectedSports.length
            ? selectedSports.join(", ")
            : "All sports"
    );

    const dates = getDateRange();

    console.log("Dates:", dates.join(", "));

    const allGames = [];
    const seenGameIds = {};

    /*
     * Fetch every configured date.
     * If an API request fails, stop before changing match records.
     */
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];

        console.log("Fetching date:", date);

        const data = await apiGet(date);
        const games = extractGames(data);

        console.log(
            "Games returned for",
            date + ":",
            games.length
        );

        games.forEach(function (game) {
            const id = getFixtureId(game);

            if (!id || seenGameIds[id]) {
                return;
            }

            seenGameIds[id] = true;
            allGames.push(game);
        });

        await sleep(REQUEST_DELAY);
    }

    if (allGames.length === 0) {
        console.log(
            "No games returned. Existing matches are unchanged."
        );

        return;
    }

    console.log(
        "Unique games fetched:",
        allGames.length
    );

    /*
     * Convert all valid games first.
     */
    const records = [];

    allGames.forEach(function (game) {
        if (!isSportSelected(game, selectedSports)) {
            return;
        }

        const converted = convertGame(game, null);

        if (!converted) {
            return;
        }

        records.push(converted);
    });

    if (records.length === 0) {
        console.log(
            "No valid games after filtering. Existing matches are unchanged."
        );

        return;
    }

    /*
     * Create competition records for all valid fetched games,
     * including competitions not yet selected by the admin.
     */
    await ensureNewSports(db, records);

    const compResult =
        await ensureCompetitionRecords(db, records);

    const competitions = compResult.competitions;
    const selections = {};

    Object.keys(compResult.selections).forEach(function (id) {
        selections[id] = normalizeBoolean(
            compResult.selections[id],
            false
        );
    });

    /*
     * Only selected competitions can contribute matches.
     */
    const selectedRecords = records.filter(function (record) {
        const id = cleanKey(record.competitionId);

        return isCompetitionSelected(
            id,
            selections,
            competitions
        );
    });

    console.log(
        "Valid games:",
        records.length
    );

    console.log(
        "Games in selected competitions:",
        selectedRecords.length
    );

    if (selectedRecords.length === 0) {
        console.log(
            "No matches belong to selected competitions."
        );

        console.log(
            "Competition records were updated; existing matches were preserved."
        );

        return;
    }

    const matchesRef = db.ref("matches");
    const matchesSnapshot = await matchesRef.once("value");
    const existingMatches = matchesSnapshot.val() || {};

    const updates = {};
    let savedCount = 0;

    selectedRecords.forEach(function (record) {
        const id = cleanKey(record.id);

        if (!id) {
            return;
        }

        const existing = existingMatches[id] || {};

        /*
         * Preserve admin-controlled values by merging old data.
         */
        const match = convertGame(
            allGames.find(function (game) {
                return getFixtureId(game) === record.id;
            }) || {},
            existing
        );

        if (!match) {
            return;
        }

        updates["matches/" + id] = match.match;
        savedCount++;
    });

    if (savedCount === 0) {
        console.log(
            "No matches were prepared for saving."
        );

        return;
    }

    /*
     * A multi-path update changes only the listed match records.
     * It does not delete old matches or unrelated Firebase data.
     */
    await db.ref().update(updates);

    const successfulTime = getTimestamp();

    await db.ref("syncSettings").update({
        lastSuccessfulSync: successfulTime,
        lastSyncProvider: PROVIDER,
        lastSyncStatus: "success",
        lastSyncGamesFetched: allGames.length,
        lastSyncMatchesSaved: savedCount
    });

    console.log("====================================");
    console.log("Sync completed successfully.");
    console.log("Provider:", PROVIDER);
    console.log("Games fetched:", allGames.length);
    console.log("Valid games:", records.length);
    console.log("Matches saved:", savedCount);
    console.log("====================================");
}

main()
    .catch(function (error) {
        console.error("Sports Hub sync failed.");

        console.error(
            error && error.message
                ? error.message
                : error
        );

        process.exitCode = 1;
    });

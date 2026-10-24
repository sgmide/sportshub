
"use strict";

const admin = require("firebase-admin");
const path = require("path");

const TIME_ZONE = "Asia/Kolkata";
const FETCH_DATES = [-1, 0, 1];

if (!admin.apps.length) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountJson) {
        throw new Error("Missing FIREBASE_SERVICE_ACCOUNT secret.");
    }

    if (!databaseURL) {
        throw new Error("Missing FIREBASE_DATABASE_URL secret.");
    }

    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
        databaseURL: databaseURL
    });
}

const db = admin.database();
const rootRef = db.ref("/");

function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function id(value) {
    return value === undefined || value === null
        ? ""
        : String(value).trim();
}

function dateString(offset) {
    const now = new Date();

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(now);

    const v = {};
    parts.forEach(function (p) {
        v[p.type] = p.value;
    });

    const date = new Date(Date.UTC(
        Number(v.year),
        Number(v.month) - 1,
        Number(v.day) + offset,
        12
    ));

    const out = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const r = {};
    out.forEach(function (p) {
        r[p.type] = p.value;
    });

    return r.day + "/" + r.month + "/" + r.year;
}

function normalizeProviderName(value) {
    const p = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/_/g, "-");

    if (["365", "365scores", "365-scores"].indexOf(p) !== -1) {
        return "365scores";
    }

    if (["api-football", "apifootball"].indexOf(p) !== -1) {
        return "api-football";
    }

    return p;
}

function getSelectedParser(settings) {
    const parserName = String(settings.selected_parser || "");

    const config =
        settings.parse && settings.parse[parserName]
            ? settings.parse[parserName]
            : {};

    return {
        parserName: parserName,
        provider: normalizeProviderName(
            config.api_parser ||
            settings.api_parser ||
            settings.provider ||
            "365scores"
        ),
        config: config
    };
}

function getSelectedSports(settings, parser) {
    const config = parser.config || {};

    let value =
        config.selectedSports ||
        config.selected_sports ||
        config.sportIds ||
        config.sport_ids ||
        settings.selectedSports ||
        settings.selected_sports ||
        settings.sportIds ||
        settings.sport_ids ||
        [];

    if (!Array.isArray(value)) {
        value = typeof value === "string"
            ? value.split(",")
            : [];
    }

    return value.map(function (item) {
        return item && typeof item === "object"
            ? number(item.id || item.sportId || item.sport_id)
            : number(item);
    }).filter(function (sportId, index, list) {
        return sportId > 0 && list.indexOf(sportId) === index;
    });
}

function loadProvider(providerName) {
    const files = {
        "365scores": "365scores.js",
        "api-football": "api-football.js"
    };

    if (!files[providerName]) {
        throw new Error("Unsupported provider: " + providerName);
    }

    const provider = require(path.join(
        __dirname,
        "apis",
        files[providerName]
    ));

    if (typeof provider.fetchMatches !== "function") {
        throw new Error(
            providerName + " must export fetchMatches(options)."
        );
    }

    return provider;
}

function getMatchId(match) {
    return id(
        match.gameId ||
        match.apiFixtureId ||
        match.fixtureId ||
        match.fixture_id ||
        match.id
    );
}

function getCompetitionId(match) {
    return id(
        match.competitionId ||
        match.competition_id ||
        match.leagueId ||
        match.league_id ||
        (match.competition && match.competition.id) ||
        (match.league && match.league.id)
    );
}

function getCompetitionName(match) {
    return String(
        match.competitionName ||
        match.competitionDisplayName ||
        match.leagueName ||
        match.league_name ||
        (match.competition && match.competition.name) ||
        (match.league && match.league.name) ||
        (typeof match.league === "string" ? match.league : "") ||
        ""
    );
}

function normalizeSport(item, providerName) {
    const sportId = id(item.id || item.sportId || item.sport_id);

    return {
        id: number(sportId),
        sportId: number(sportId),
        name: String(item.name || item.sportName || ""),
        nameForURL: String(item.nameForURL || ""),
        totalGames: number(item.totalGames),
        liveGames: number(item.liveGames),
        provider: providerName
    };
}

function normalizeCompetition(item, providerName) {
    const competitionId = id(
        item.id ||
        item.competitionId ||
        item.competition_id ||
        item.leagueId ||
        item.league_id
    );

    return {
        id: number(competitionId),
        competitionId: number(competitionId),
        sportId: number(
            item.sportId ||
            item.sport_id ||
            (typeof item.sport === "object" ? item.sport.id : item.sport)
        ),
        countryId: number(item.countryId || item.country_id),
        name: String(
            item.name ||
            item.competitionDisplayName ||
            item.leagueName ||
            item.league_name ||
            ""
        ),
        nameForURL: String(item.nameForURL || ""),
        hideOnCatalog: item.hideOnCatalog === true,
        hideOnSearch: item.hideOnSearch === true,
        isInternational: item.isInternational === true,
        totalGames: number(item.totalGames),
        liveGames: number(item.liveGames),
        provider: providerName
    };
}

function buildSportsCatalog(catalog, providerName) {
    const result = {};

    (catalog.sports || []).forEach(function (item) {
        const sport = normalizeSport(item, providerName);

        if (sport.id > 0) {
            result[String(sport.id)] = sport;
        }
    });

    return result;
}

function buildCompetitionCatalog(
    catalog,
    matches,
    selectedSports,
    providerName
) {
    const result = {};
    const allowedSports = {};

    selectedSports.forEach(function (sportId) {
        allowedSports[String(sportId)] = true;
    });

    function add(item) {
        const competition = normalizeCompetition(item, providerName);
        const competitionId = id(competition.id);

        if (!competitionId || competition.hideOnCatalog) {
            return;
        }

        if (
            selectedSports.length &&
            !allowedSports[String(competition.sportId)]
        ) {
            return;
        }

        result[competitionId] = competition;
    }

    (catalog.competitions || []).forEach(add);

    (matches || []).forEach(function (match) {
        const competitionId = getCompetitionId(match);

        if (!competitionId || result[competitionId]) {
            return;
        }

        add({
            id: competitionId,
            sportId: match.sportId || match.sport_id || match.sport,
            countryId: match.countryId || match.country_id,
            name: getCompetitionName(match)
        });
    });

    return result;
}

function buildSelection(newCatalog, oldSelection) {
    const result = {};

    Object.keys(newCatalog).forEach(function (competitionId) {
        result[competitionId] =
            !!(oldSelection && oldSelection[competitionId] === true);
    });

    return result;
}

function filterSelectedMatches(
    matches,
    selection,
    selectedSports,
    providerName
) {
    const allowedSports = {};
    const result = {};
    const seen = {};

    selectedSports.forEach(function (sportId) {
        allowedSports[String(sportId)] = true;
    });

    matches.forEach(function (match) {
        const matchId = getMatchId(match);
        const competitionId = getCompetitionId(match);

        if (
            !matchId ||
            !competitionId ||
            seen[matchId] ||
            selection[competitionId] !== true
        ) {
            return;
        }

        const sportId = number(
            match.sportId || match.sport_id || match.sport
        );

        if (
            selectedSports.length &&
            !allowedSports[String(sportId)]
        ) {
            return;
        }

        seen[matchId] = true;

        result[matchId] = Object.assign({}, match, {
            gameId: matchId,
            apiFixtureId: matchId,
            competitionId: number(competitionId),
            sportId: sportId,
            apiProvider: providerName
        });
    });

    return result;
}

async function fetchMatchesForDates(provider, selectedSports) {
    const result = [];
    const seen = {};

    for (let i = 0; i < FETCH_DATES.length; i++) {
        const date = dateString(FETCH_DATES[i]);

        const matches = await provider.fetchMatches({
            sportIds: selectedSports,
            startDate: date,
            endDate: date,
            timeZone: TIME_ZONE
        });

        if (!Array.isArray(matches)) {
            throw new Error("fetchMatches() did not return an array.");
        }

        console.log("Date:", date, "matches:", matches.length);

        matches.forEach(function (match) {
            const matchId = getMatchId(match);

            if (!matchId || seen[matchId]) {
                return;
            }

            seen[matchId] = true;
            result.push(match);
        });
    }

    return result;
}

async function main() {
    const snapshot = await rootRef.once("value");
    const root = snapshot.val() || {};
    const settings = root.settings || {};

    const parser = getSelectedParser(settings);
    const provider = loadProvider(parser.provider);
    const selectedSports = getSelectedSports(settings, parser);

    const oldProvider = normalizeProviderName(
        settings.last_synced_api_provider || ""
    );

    const providerChanged = oldProvider !== parser.provider;

    console.log("Provider:", parser.provider);
    console.log("Selected parser:", parser.parserName);
    console.log("Selected sports:", selectedSports);
    console.log("Provider changed:", providerChanged);

    if (typeof provider.fetchCatalog !== "function") {
        throw new Error(
            "Provider must export fetchCatalog() to load sports."
        );
    }

    const catalog = await provider.fetchCatalog({
        sportIds: selectedSports,
        timeZone: TIME_ZONE
    });

    if (!catalog || !Array.isArray(catalog.sports)) {
        throw new Error(
            "Provider returned no valid sports catalog. Firebase data preserved."
        );
    }

    const sportsCatalog = buildSportsCatalog(catalog, parser.provider);

    if (Object.keys(sportsCatalog).length === 0) {
        throw new Error(
            "No sports were returned. Existing Firebase data preserved."
        );
    }

    /*
     * STAGE 1:
     * API changed -> save only the new API's sports.
     * Do not fetch or save matches in this stage.
     */
    if (providerChanged) {
        await rootRef.update({
            sports: sportsCatalog,
            competitions: {},
            competition_selection: {},
            matches: {},
            "settings/last_synced_api_provider": parser.provider,
            "settings/last_sync_status": "success",
            "settings/last_sync_error": null,
            "settings/last_sync_time": Date.now()
        });

        console.log("STAGE 1 complete: sports saved only.");
        console.log("Select sports in Admin, then run sync again.");
        return;
    }

    /*
     * A sports selection is required before loading competitions.
     */
    if (selectedSports.length === 0) {
        await rootRef.update({
            sports: sportsCatalog,
            "settings/last_sync_status": "waiting_for_sports",
            "settings/last_sync_error": null,
            "settings/last_sync_time": Date.now()
        });

        console.log("No sports selected. Waiting for Admin selection.");
        return;
    }

    /*
     * STAGE 2:
     * Load competitions for selected sports.
     * Some providers (including some 365Scores responses) do not
     * return a competition catalog, so derive it from game data.
     * The fetched games are used only to discover competitions here.
     */
    let discoveryMatches = [];

    if (!Array.isArray(catalog.competitions) ||
        catalog.competitions.length === 0) {
        discoveryMatches = await fetchMatchesForDates(
            provider,
            selectedSports
        );
    }

    const newCatalog = buildCompetitionCatalog(
        catalog,
        discoveryMatches,
        selectedSports,
        parser.provider
    );

    if (Object.keys(newCatalog).length === 0) {
        throw new Error(
            "No competitions found for selected sports. Existing data preserved."
        );
    }

    const oldSelection = root.competition_selection || {};
    const selection = buildSelection(newCatalog, oldSelection);

    /*
     * Replace the catalog, not merge it with another API's old catalog.
     * Remove selections belonging to competitions no longer in this catalog.
     */
    await rootRef.update({
        sports: sportsCatalog,
        competitions: newCatalog,
        competition_selection: selection,
        "settings/last_synced_api_provider": parser.provider,
        "settings/last_sync_status": "success",
        "settings/last_sync_error": null,
        "settings/last_sync_time": Date.now()
    });

    console.log(
        "STAGE 2: competitions saved:",
        Object.keys(newCatalog).length
    );

    const selectedCompetitionIds = Object.keys(selection).filter(
        function (competitionId) {
            return selection[competitionId] === true;
        }
    );

    /*
     * No competition selected yet: stop without saving matches.
     */
    if (selectedCompetitionIds.length === 0) {
        console.log("No competitions selected.");
        console.log("Select competitions in Admin, then run sync again.");
        return;
    }

    /*
     * STAGE 3:
     * Fetch games and save only games belonging to selected competitions.
     */
    const allMatches = await fetchMatchesForDates(
        provider,
        selectedSports
    );

    const selectedMatches = filterSelectedMatches(
        allMatches,
        selection,
        selectedSports,
        parser.provider
    );

    if (Object.keys(selectedMatches).length === 0) {
        console.log(
            "No matches found for selected competitions. Existing matches preserved."
        );

        await rootRef.child("settings").update({
            last_sync_status: "no_selected_matches",
            last_sync_error: null,
            last_sync_time: Date.now()
        });

        return;
    }

    /*
     * Replace the matches collection with selected-competition matches only.
     */
    await rootRef.update({
        matches: selectedMatches,
        "settings/last_sync_status": "success",
        "settings/last_sync_error": null,
        "settings/last_sync_time": Date.now()
    });

    console.log(
        "STAGE 3 complete. Saved selected matches:",
        Object.keys(selectedMatches).length
    );
}

main().catch(async function (error) {
    console.error("SportsHub sync failed:", error);

    try {
        await db.ref("settings").update({
            last_sync_status: "failed",
            last_sync_error: String(error.message || error),
            last_sync_time: Date.now()
        });
    } catch (saveError) {
        console.error(
            "Could not save error status:",
            saveError.message
        );
    }

    process.exitCode = 1;
});

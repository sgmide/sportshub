
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
        credential: admin.credential.cert(
            JSON.parse(serviceAccountJson)
        ),
        databaseURL: databaseURL
    });
}

const db = admin.database();
const rootRef = db.ref("/");

function number(value) {
    if (value === null || value === undefined || value === "") {
        return 0;
    }

    const n = Number(value);

    return Number.isFinite(n) ? n : 0;
}

function id(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value).trim();
}

function getDateParts(offset) {
    const now = new Date();

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(now);

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    const date = new Date(Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day) + offset,
        12
    ));

    const outputParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const result = {};

    outputParts.forEach(function (part) {
        result[part.type] = part.value;
    });

    return result;
}

function dateString(offset) {
    const values = getDateParts(offset);

    return values.day + "/" +
        values.month + "/" +
        values.year;
}

function isoDateString(offset) {
    const values = getDateParts(offset);

    return values.year + "-" +
        values.month + "-" +
        values.day;
}

function normalizeProviderName(value) {
    const provider = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/_/g, "-");

    if ([
        "365",
        "365scores",
        "365-scores"
    ].indexOf(provider) !== -1) {
        return "365scores";
    }

    if ([
        "api-football",
        "apifootball",
        "football"
    ].indexOf(provider) !== -1) {
        return "api-football";
    }

    return provider;
}

function getSelectedParser(settings) {
    const parserName = String(
        settings.selected_parser || "parse1"
    );

    const config =
        settings.parse &&
        settings.parse[parserName]
            ? settings.parse[parserName]
            : {};

    const provider = normalizeProviderName(
        config.api_parser ||
        settings.api_parser ||
        settings.provider ||
        process.env.API_PROVIDER ||
        "365scores"
    );

    return {
        parserName: parserName,
        provider: provider,
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

    const result = [];

    value.forEach(function (item) {
        let sportId;

        if (item && typeof item === "object") {
            sportId = number(
                item.id ||
                item.sportId ||
                item.sport_id
            );
        } else {
            sportId = number(item);
        }

        if (
            sportId > 0 &&
            result.indexOf(sportId) === -1
        ) {
            result.push(sportId);
        }
    });

    /*
     * API-Football is a football-only provider.
     * Its sport ID in this app is 1.
     */
    if (
        parser.provider === "api-football" &&
        result.length === 0
    ) {
        return [];
    }

    return result;
}

function loadProvider(providerName) {
    const files = {
        "365scores": "365scores.js",
        "api-football": "api-football.js"
    };

    if (!files[providerName]) {
        throw new Error(
            "Unsupported provider: " + providerName
        );
    }

    const provider = require(path.join(
        __dirname,
        "apis",
        files[providerName]
    ));

    if (typeof provider.fetchMatches !== "function") {
        throw new Error(
            providerName +
            " must export fetchMatches(options)."
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
        (typeof match.league === "string"
            ? match.league
            : "") ||
        ""
    );
}

function getSportId(item) {
    if (!item) {
        return 0;
    }

    if (typeof item === "object") {
        return number(
            item.sportId ||
            item.sport_id ||
            item.id
        );
    }

    return number(item);
}

function normalizeSport(item, providerName) {
    const sportId = id(
        item.id ||
        item.sportId ||
        item.sport_id
    );

    return {
        id: number(sportId),
        sportId: number(sportId),
        name: String(
            item.name ||
            item.sportName ||
            ""
        ),
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

        sportId: getSportId(
            item.sportId ||
            item.sport_id ||
            item.sport
        ),

        countryId: number(
            item.countryId ||
            item.country_id
        ),

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

    /*
     * API-Football provides fixtures, not a sports catalog
     * through the fetchMatches-only module.
     */
    if (providerName === "api-football") {
        result["1"] = {
            id: 1,
            sportId: 1,
            name: "Football",
            nameForURL: "football",
            totalGames: 0,
            liveGames: 0,
            provider: providerName
        };

        return result;
    }

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
        const competition = normalizeCompetition(
            item,
            providerName
        );

        const competitionId = id(competition.id);

        if (!competitionId || competition.hideOnCatalog) {
            return;
        }

        /*
         * Do not discard a competition merely because a provider
         * omits sportId. When present, sportId must match selection.
         */
        if (
            selectedSports.length &&
            competition.sportId > 0 &&
            !allowedSports[String(competition.sportId)]
        ) {
            return;
        }

        if (!competition.name) {
            competition.name = "Competition " + competitionId;
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
            sportId: getSportId(
                match.sportId ||
                match.sport_id ||
                match.sport
            ),
            countryId: match.countryId || match.country_id,
            name: getCompetitionName(match)
        });
    });

    return result;
}

function buildSelection(newCatalog, oldSelection) {
    const result = {};

    Object.keys(newCatalog).forEach(function (competitionId) {
        result[competitionId] = !!(
            oldSelection &&
            oldSelection[competitionId] === true
        );
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

        const sportId = getSportId(
            match.sportId ||
            match.sport_id ||
            match.sport
        );

        if (
            selectedSports.length &&
            sportId > 0 &&
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

async function fetchMatchesForDates(
    provider,
    selectedSports,
    settings,
    parser
) {
    const result = [];
    const seen = {};

    for (let i = 0; i < FETCH_DATES.length; i++) {
        const offset = FETCH_DATES[i];
        let options;

        if (parser.provider === "api-football") {
            /*
             * API-Football expects:
             * options.date = YYYY-MM-DD
             */
            options = {
                date: isoDateString(offset),
                settings: settings,
                parserSettings: parser.config,
                sportIds: selectedSports,
                timeZone: TIME_ZONE
            };
        } else {
            /*
             * 365Scores expects:
             * startDate/endDate = DD/MM/YYYY
             */
            const date = dateString(offset);

            options = {
                sportIds: selectedSports,
                startDate: date,
                endDate: date,
                timeZone: TIME_ZONE
            };
        }

        const matches = await provider.fetchMatches(options);

        if (!Array.isArray(matches)) {
            throw new Error(
                "fetchMatches() did not return an array."
            );
        }

        console.log(
            "Date offset:",
            offset,
            "matches:",
            matches.length
        );

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

async function getProviderCatalog(provider, providerName) {
    if (typeof provider.fetchCatalog === "function") {
        const catalog = await provider.fetchCatalog({
            timeZone: TIME_ZONE
        });

        if (!catalog || !Array.isArray(catalog.sports)) {
            throw new Error(
                "Provider returned an invalid sports catalog."
            );
        }

        return {
            sports: catalog.sports,
            competitions: Array.isArray(catalog.competitions)
                ? catalog.competitions
                : []
        };
    }

    if (providerName === "api-football") {
        return {
            sports: [
                {
                    id: 1,
                    name: "Football",
                    nameForURL: "football"
                }
            ],
            competitions: []
        };
    }

    throw new Error(
        "Provider must export fetchCatalog()."
    );
}

async function main() {
    const snapshot = await rootRef.once("value");
    const root = snapshot.val() || {};
    const settings = root.settings || {};

    const parser = getSelectedParser(settings);
    const provider = loadProvider(parser.provider);

    const selectedSports = getSelectedSports(
        settings,
        parser
    );

    const oldProvider = normalizeProviderName(
        settings.last_synced_api_provider || ""
    );

    const providerChanged =
        oldProvider !== parser.provider;

    console.log("Provider:", parser.provider);
    console.log("Selected parser:", parser.parserName);
    console.log("Selected sports:", selectedSports);
    console.log("Previous provider:", oldProvider || "(none)");
    console.log("Provider changed:", providerChanged);

    const catalog = await getProviderCatalog(
        provider,
        parser.provider
    );

    const sportsCatalog = buildSportsCatalog(
        catalog,
        parser.provider
    );

    if (Object.keys(sportsCatalog).length === 0) {
        throw new Error(
            "No sports returned. Firebase data preserved."
        );
    }

    /*
     * STAGE 1:
     * A provider change resets provider-specific data.
     * Only the new provider's sports catalog is saved.
     */
    if (providerChanged) {
        await rootRef.update({
            sports: sportsCatalog,
            competitions: {},
            competition_selection: {},
            matches: {},

            "settings/last_synced_api_provider":
                parser.provider,

            "settings/last_sync_status":
                "waiting_for_sports",

            "settings/last_sync_error": null,
            "settings/last_sync_time": Date.now()
        });

        console.log(
            "STAGE 1 complete: new provider sports saved."
        );

        console.log(
            "Choose sports in Admin, then run sync again."
        );

        return;
    }

    /*
     * Save current provider's sports catalog.
     */
    await rootRef.child("sports").set(sportsCatalog);

    /*
     * Wait until Admin has selected sports.
     */
    if (selectedSports.length === 0) {
        await rootRef.child("settings").update({
            last_sync_status: "waiting_for_sports",
            last_sync_error: null,
            last_sync_time: Date.now()
        });

        console.log(
            "No sports selected. Waiting for Admin selection."
        );

        return;
    }

    /*
     * STAGE 2:
     * Discover competitions for selected sports.
     */
    let discoveryMatches = [];

    if (
        !Array.isArray(catalog.competitions) ||
        catalog.competitions.length === 0
    ) {
        discoveryMatches = await fetchMatchesForDates(
            provider,
            selectedSports,
            settings,
            parser
        );
    }

    const newCatalog = buildCompetitionCatalog(
        catalog,
        discoveryMatches,
        selectedSports,
        parser.provider
    );

    if (Object.keys(newCatalog).length === 0) {
        await rootRef.child("settings").update({
            last_sync_status: "waiting_for_competitions",
            last_sync_error:
                "No competitions found for selected sports.",
            last_sync_time: Date.now()
        });

        throw new Error(
            "No competitions found for selected sports."
        );
    }

    const oldSelection = root.competition_selection || {};

    const selection = buildSelection(
        newCatalog,
        oldSelection
    );

    /*
     * Replace catalogs so stale competitions from the previous
     * catalog are not retained.
     */
    await rootRef.update({
        competitions: newCatalog,
        competition_selection: selection,

        "settings/last_synced_api_provider":
            parser.provider,

        "settings/last_sync_status": "success",
        "settings/last_sync_error": null,
        "settings/last_sync_time": Date.now()
    });

    console.log(
        "Competitions saved:",
        Object.keys(newCatalog).length
    );

    const selectedCompetitionIds = Object.keys(selection).filter(
        function (competitionId) {
            return selection[competitionId] === true;
        }
    );

    /*
     * No competitions selected:
     * do not leave matches from old/unselected competitions.
     */
    if (selectedCompetitionIds.length === 0) {
        await rootRef.child("matches").set({});

        await rootRef.child("settings").update({
            last_sync_status: "waiting_for_competitions",
            last_sync_error: null,
            last_sync_time: Date.now()
        });

        console.log(
            "No competitions selected. Matches cleared."
        );

        console.log(
            "Choose competitions in Admin, then run sync again."
        );

        return;
    }

    /*
     * STAGE 3:
     * Fetch fixtures and keep selected competitions only.
     */
    const allMatches = await fetchMatchesForDates(
        provider,
        selectedSports,
        settings,
        parser
    );

    const selectedMatches = filterSelectedMatches(
        allMatches,
        selection,
        selectedSports,
        parser.provider
    );

    /*
     * Replace the collection even when there are no fixtures.
     * This prevents stale matches from unselected competitions.
     */
    await rootRef.child("matches").set(selectedMatches);

    await rootRef.child("settings").update({
        last_sync_status:
            Object.keys(selectedMatches).length > 0
                ? "success"
                : "no_selected_matches",

        last_sync_error: null,
        last_sync_time: Date.now()
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
            last_sync_error: String(
                error.message || error
            ),
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

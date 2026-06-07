import { formatItem, formatItemBrief } from "./itemFormatter";

declare let ztoolkit: ZToolkit;

class MCPError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "MCPError";
  }
}

// Supported search parameter interface
interface SearchParams {
  q?: string;
  key?: string; // Key for exact match
  title?: string;
  creator?: string;
  year?: string;
  tag?: string; // Backwards compatibility
  tags?: string | string[]; // Supports string or array
  tagMode?: "any" | "all" | "none";
  tagMatch?: "exact" | "contains" | "startsWith";
  itemType?: string;
  doi?: string;
  isbn?: string;
  collection?: string;
  hasAttachment?: string;
  hasNote?: string;
  limit?: string;
  offset?: string;
  sort?: string;
  direction?: string;
  libraryID?: string; // Library ID parameter
  includeAttachments?: string; // Whether to include attachments
  includeNotes?: string; // Whether to include notes

  // Full-text search parameters
  fulltext?: string; // Full-text search content
  fulltextMode?: "attachment" | "note" | "both"; // Full-text mode: attachments only, notes only, or both
  fulltextOperator?: "contains" | "exact" | "regex"; // Full-text search operator

  // Advanced search parameters
  titleOperator?: "contains" | "exact" | "startsWith" | "endsWith" | "regex";
  creatorOperator?: "contains" | "exact" | "startsWith" | "endsWith";
  yearRange?: string; // Format: "2020-2023", "2020-", or "-2023"
  dateAdded?: string; // ISO date string
  dateAddedRange?: string; // Format: "2023-01-01,2023-12-31"
  dateModified?: string;
  dateModifiedRange?: string;
  publicationTitle?: string;
  publicationTitleOperator?: "contains" | "exact";
  abstractText?: string;
  abstractOperator?: "contains" | "regex";
  language?: string;
  rights?: string;
  url?: string;
  extra?: string;
  numPages?: string;
  numPagesRange?: string; // Format: "100-500"

  // Boolean query support
  booleanQuery?: string; // Advanced boolean query string
  fieldQueries?: FieldQuery[]; // Structured field queries

  // Result relevance and sorting
  relevanceScoring?: "true" | "false";
  boostFields?: string; // Comma-separated fields used to boost relevance weight

  // Saved search
  savedSearchName?: string;
  saveSearch?: "true" | "false";
}

// Field query structure
interface FieldQuery {
  field: string;
  operator:
    | "contains"
    | "exact"
    | "startsWith"
    | "endsWith"
    | "regex"
    | "range"
    | "gt"
    | "lt"
    | "gte"
    | "lte";
  value: string;
  boost?: number; // Weight boost factor
}

// Relevance scoring result
interface ScoredItem {
  item: Zotero.Item;
  relevanceScore: number;
  matchedFields: string[];
}

// Supported sort fields
const SUPPORTED_SORT_FIELDS = [
  "date",
  "title",
  "creator",
  "dateAdded",
  "dateModified",
  "relevance",
];

/**
 * Sort items with precomputed sort keys (Schwartzian transform), yielding every 200 items
 */
async function sortItemsWithYield(
  items: Zotero.Item[],
  sort: string,
  direction: string,
): Promise<Zotero.Item[]> {
  // Precompute sort keys
  const sortKeyMap = new Map<number, string>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let key: string;
    if (sort === "creator") {
      key = item.getCreators().map((c) => c.lastName).join(", ").toLowerCase();
    } else {
      key = String(item.getField(sort as any) || "").toLowerCase();
    }
    sortKeyMap.set(item.id, key);

    if (i > 0 && i % 200 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  items.sort((a, b) => {
    const valA = sortKeyMap.get(a.id) || "";
    const valB = sortKeyMap.get(b.id) || "";
    if (valA < valB) return direction === "asc" ? -1 : 1;
    if (valA > valB) return direction === "asc" ? 1 : -1;
    return 0;
  });

  return items;
}

// Advanced search helper functions

/**
 * Parse date range string
 * @param rangeStr Format: "2020-2023", "2020-", "-2023", or "2023-01-01,2023-12-31"
 * @returns {start: Date|null, end: Date|null}
 */
function parseDateRange(rangeStr: string): {
  start: Date | null;
  end: Date | null;
} {
  if (!rangeStr) return { start: null, end: null };

  // Handle comma-separated date format
  if (rangeStr.includes(",")) {
    const [startStr, endStr] = rangeStr.split(",").map((s) => s.trim());
    return {
      start: startStr ? new Date(startStr) : null,
      end: endStr ? new Date(endStr) : null,
    };
  }

  // Handle hyphen-separated year format
  if (rangeStr.includes("-")) {
    const parts = rangeStr.split("-");
    if (parts.length === 2) {
      const [startYear, endYear] = parts;
      return {
        start: startYear ? new Date(`${startYear}-01-01`) : null,
        end: endYear ? new Date(`${endYear}-12-31`) : null,
      };
    }
  }

  return { start: null, end: null };
}

/**
 * Parse numeric range string
 * @param rangeStr Format: "100-500", "100-", or "-500"
 * @returns {min: number|null, max: number|null}
 */
function parseNumberRange(rangeStr: string): {
  min: number | null;
  max: number | null;
} {
  if (!rangeStr) return { min: null, max: null };

  if (rangeStr.includes("-")) {
    const parts = rangeStr.split("-");
    if (parts.length === 2) {
      const [minStr, maxStr] = parts;
      return {
        min: minStr ? parseInt(minStr, 10) : null,
        max: maxStr ? parseInt(maxStr, 10) : null,
      };
    }
  }

  return { min: null, max: null };
}

/**
 * Check whether a field value matches the operator and query value
 * @param fieldValue Field value
 * @param operator Operator
 * @param queryValue Query value
 * @returns Whether it matches
 */
function matchesFieldQuery(
  fieldValue: any,
  operator: string,
  queryValue: string,
): boolean {
  if (!fieldValue && !queryValue) return true;
  if (!fieldValue || !queryValue) return false;

  const fieldStr = String(fieldValue).toLowerCase();
  const queryStr = queryValue.toLowerCase();

  switch (operator) {
    case "exact":
      return fieldStr === queryStr;
    case "contains":
      return fieldStr.includes(queryStr);
    case "startsWith":
      return fieldStr.startsWith(queryStr);
    case "endsWith":
      return fieldStr.endsWith(queryStr);
    case "regex":
      try {
        const regex = new RegExp(queryValue, "i");
        return regex.test(fieldStr);
      } catch {
        return false;
      }
    default:
      return fieldStr.includes(queryStr);
  }
}

/**
 * Calculate item relevance score
 * @param item Zotero item
 * @param params Search parameters
 * @returns Relevance score and matched fields
 */
function calculateRelevanceScore(
  item: Zotero.Item,
  params: SearchParams,
): { score: number; matchedFields: string[] } {
  let score = 0;
  const matchedFields: string[] = [];
  const boostFields = params.boostFields?.split(",").map((f) => f.trim()) || [];

  // Base field weights
  const fieldWeights: Record<string, number> = {
    title: 3.0,
    creator: 2.0,
    abstractNote: 1.5,
    publicationTitle: 1.2,
    tags: 1.0,
    extra: 0.5,
  };

  // Apply boost weights
  boostFields.forEach((field) => {
    if (fieldWeights[field]) {
      fieldWeights[field] *= 2;
    }
  });

  // Check matches for each field
  if (params.q) {
    const query = params.q.toLowerCase();
    Object.entries(fieldWeights).forEach(([field, weight]) => {
      let fieldValue: string = "";

      if (field === "creator") {
        fieldValue = item
          .getCreators()
          .map((c) => `${c.firstName} ${c.lastName}`)
          .join(" ");
      } else if (field === "tags") {
        fieldValue = item
          .getTags()
          .map((t) => t.tag)
          .join(" ");
      } else {
        try {
          fieldValue = item.getField(field as any) || "";
        } catch {
          fieldValue = "";
        }
      }

      if (fieldValue.toLowerCase().includes(query)) {
        score += weight;
        matchedFields.push(field);
      }
    });
  }

  // Add points for specific field matches
  if (
    params.title &&
    item.getField("title")?.toLowerCase().includes(params.title.toLowerCase())
  ) {
    score += fieldWeights.title || 3.0;
    if (!matchedFields.includes("title")) matchedFields.push("title");
  }

  if (params.creator) {
    const creators = item
      .getCreators()
      .map((c) => `${c.firstName} ${c.lastName}`.toLowerCase());
    if (creators.some((c) => c.includes(params.creator!.toLowerCase()))) {
      score += fieldWeights.creator || 2.0;
      if (!matchedFields.includes("creator")) matchedFields.push("creator");
    }
  }

  return { score, matchedFields };
}

/**
 * Perform full-text search
 * @param query Search term
 * @param libraryID Library ID
 * @param mode Search mode
 * @param operator Operator
 * @returns List of matching item IDs
 */
async function performFulltextSearch(
  query: string,
  libraryID: number,
  mode: "attachment" | "note" | "both" = "both",
  operator: "contains" | "exact" | "regex" = "contains"
): Promise<{ itemIDs: number[], matchDetails: Map<number, any> }> {
  const matchDetails = new Map<number, any>();
  const itemIDSet = new Set<number>();

  try {
    if (mode === "attachment" || mode === "both") {
      // Use Zotero.Search for attachment full text
      const attachmentSearch = new Zotero.Search();
      (attachmentSearch as any).libraryID = libraryID;

      // Search attachment content
      const searchOperator = operator === "exact" ? "is" : "contains";
      attachmentSearch.addCondition("fulltextContent", searchOperator, query);
      attachmentSearch.addCondition("itemType", "is", "attachment");

      const attachmentIDs = await attachmentSearch.search();

      for (let i = 0; i < attachmentIDs.length; i++) {
        const attachmentID = attachmentIDs[i];
        const attachment = Zotero.Items.get(attachmentID);
        if (attachment && attachment.isAttachment()) {
          const parentItem = attachment.parentItem;
          const targetID = parentItem ? parentItem.id : attachment.id;

          if (parentItem) {
            itemIDSet.add(parentItem.id);
          } else {
            itemIDSet.add(attachment.id);
          }

          // Record match details
          if (!matchDetails.has(targetID)) {
            matchDetails.set(targetID, {
              attachments: [],
              notes: [],
              score: 0
            });
          }

          const details = matchDetails.get(targetID);

          // Try extracting snippet directly through SQL to avoid loading full attachment text
          let snippet = '';
          try {
            const sqlResult = await Zotero.DB.valueQueryAsync(
              `SELECT substr(content, max(1, instr(lower(content), lower(?1)) - 50), 150) FROM fulltextContent WHERE itemID = ?2`,
              [query, attachment.id]
            );
            if (sqlResult) {
              snippet = '...' + sqlResult + '...';
            }
          } catch (_dbErr) {
            // Fallback: load text, limited to the first 50 KB
            try {
              const content = await attachment.attachmentText || '';
              if (content) {
                const searchContent = content.length > 50000 ? content.substring(0, 50000) : content;
                const queryPos = searchContent.toLowerCase().indexOf(query.toLowerCase());
                if (queryPos >= 0) {
                  const start = Math.max(0, queryPos - 50);
                  const end = Math.min(searchContent.length, queryPos + query.length + 50);
                  snippet = '...' + searchContent.substring(start, end) + '...';
                }
              }
            } catch (_e) {
              snippet = '';
            }
          }

          details.attachments.push({
            attachmentID: attachment.id,
            filename: attachment.attachmentFilename || '',
            snippet: snippet,
            score: 1
          });
          details.score += 1;
        }

        // Yield to the main thread every 10 attachments
        if (i > 0 && i % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }

    if (mode === "note" || mode === "both") {
      // Search note content
      const s = new Zotero.Search();
      (s as any).libraryID = libraryID;
      s.addCondition("itemType", "is", "note");

      // Set search condition based on operator
      const searchOperator = operator === "exact" ? "is" : "contains";
      s.addCondition("note", searchOperator, query);

      const noteIDs = await s.search();

      for (const noteID of noteIDs) {
        const note = Zotero.Items.get(noteID);
        if (note && note.isNote()) {
          const parentItem = note.parentItem;
          if (parentItem) {
            itemIDSet.add(parentItem.id);
          }

          const targetID = parentItem ? parentItem.id : note.id;
          if (!matchDetails.has(targetID)) {
            matchDetails.set(targetID, {
              attachments: [],
              notes: [],
              score: 0
            });
          }
          
          const details = matchDetails.get(targetID);
          const noteContent = note.getNote();
          let snippet = '';
          
          // Extract matching snippet
          if (noteContent) {
            const cleanContent = noteContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
            const queryPos = cleanContent.toLowerCase().indexOf(query.toLowerCase());
            if (queryPos >= 0) {
              const start = Math.max(0, queryPos - 50);
              const end = Math.min(cleanContent.length, queryPos + query.length + 50);
              snippet = '...' + cleanContent.substring(start, end) + '...';
            }
          }
          
          details.notes.push({
            noteID: note.id,
            snippet: snippet,
            score: 1
          });
          details.score += 1;
        }
      }
    }

    return { itemIDs: Array.from(itemIDSet), matchDetails };
  } catch (error) {
    ztoolkit.log(`[SearchEngine] Fulltext search error: ${error}`, "error");
    return { itemIDs: [], matchDetails };
  }
}

/**
 * Apply advanced filters to item list
 * @param items Item list
 * @param params Search parameters
 * @returns Filtered item list
 */
function applyAdvancedFilters(
  items: Zotero.Item[],
  params: SearchParams,
): Zotero.Item[] {
  return items.filter((item) => {
    // Date range filter
    if (params.yearRange) {
      const { start, end } = parseDateRange(params.yearRange);
      if (start || end) {
        const itemDate = item.getField("date");
        if (itemDate) {
          const year = parseInt(itemDate.toString().substring(0, 4), 10);
          if (start && year < start.getFullYear()) return false;
          if (end && year > end.getFullYear()) return false;
        }
      }
    }

    // Add date range filter
    if (params.dateAddedRange) {
      const { start, end } = parseDateRange(params.dateAddedRange);
      if (start || end) {
        const dateAdded = new Date(item.dateAdded);
        if (start && dateAdded < start) return false;
        if (end && dateAdded > end) return false;
      }
    }

    // Date modified range filter
    if (params.dateModifiedRange) {
      const { start, end } = parseDateRange(params.dateModifiedRange);
      if (start || end) {
        const dateModified = new Date(item.dateModified);
        if (start && dateModified < start) return false;
        if (end && dateModified > end) return false;
      }
    }

    // Page count range filter
    if (params.numPagesRange) {
      const { min, max } = parseNumberRange(params.numPagesRange);
      if (min || max) {
        const numPages = parseInt(item.getField("numPages") || "0", 10);
        if (min && numPages < min) return false;
        if (max && numPages > max) return false;
      }
    }

    // Advanced field matching
    if (params.titleOperator && params.title) {
      const title = item.getField("title") || "";
      if (!matchesFieldQuery(title, params.titleOperator, params.title)) {
        return false;
      }
    }

    if (params.creatorOperator && params.creator) {
      const creators = item
        .getCreators()
        .map((c) => `${c.firstName} ${c.lastName}`)
        .join(" ");
      if (
        !matchesFieldQuery(creators, params.creatorOperator, params.creator)
      ) {
        return false;
      }
    }

    if (params.abstractOperator && params.abstractText) {
      const abstract = item.getField("abstractNote") || "";
      if (
        !matchesFieldQuery(
          abstract,
          params.abstractOperator,
          params.abstractText,
        )
      ) {
        return false;
      }
    }

    if (params.publicationTitleOperator && params.publicationTitle) {
      const pubTitle = item.getField("publicationTitle") || "";
      if (
        !matchesFieldQuery(
          pubTitle,
          params.publicationTitleOperator,
          params.publicationTitle,
        )
      ) {
        return false;
      }
    }

    // Exact match for other fields
    const exactMatchFields = ["language", "rights", "url", "extra"];
    for (const field of exactMatchFields) {
      const paramValue = params[field as keyof SearchParams];
      if (paramValue && typeof paramValue === "string") {
        const fieldValue = item.getField(field as any) || "";
        if (!fieldValue.toLowerCase().includes(paramValue.toLowerCase())) {
          return false;
        }
      }
    }

    return true;
  });
}

/**
 * Handle search engine request
 * @param params Search parameters
 */
export async function handleSearchRequest(
  params: SearchParams,
): Promise<Record<string, any>> {
  Zotero.debug(
    `[MCP Search] Received search params: ${JSON.stringify(params)}`,
  );
  const startTime = Date.now();

  // --- 1. Parameter processing and validation ---
  const libraryID = params.libraryID
    ? parseInt(params.libraryID, 10)
    : Zotero.Libraries.userLibraryID;
  const limit = Math.min(parseInt(params.limit || "100", 10), 500);
  const offset = parseInt(params.offset || "0", 10);
  const sort = params.sort || "dateAdded";
  const direction = params.direction || "desc";

  if (!SUPPORTED_SORT_FIELDS.includes(sort)) {
    throw new MCPError(
      400,
      `Unsupported sort field: ${sort}. Supported fields are: ${SUPPORTED_SORT_FIELDS.join(", ")}`,
    );
  }
  if (!["asc", "desc"].includes(direction.toLowerCase())) {
    throw new MCPError(
      400,
      `Unsupported sort direction: ${direction}. Use 'asc' or 'desc'.`,
    );
  }

  // --- 2. Exact key lookup (priority) ---
  if (params.key) {
    const item = await Zotero.Items.getByLibraryAndKeyAsync(
      libraryID,
      params.key,
    );
    return {
      query: params,
      pagination: { limit: 1, offset: 0, total: item ? 1 : 0, hasMore: false },
      searchTime: `${Date.now() - startTime}ms`,
      results: item ? [await formatItem(item)] : [],
    };
  }

  // --- 3. Handle full-text search (high priority) ---
  let fulltextItemIDs: number[] = [];
  let fulltextMatchDetails = new Map<number, any>();

  if (params.fulltext) {
    const mode = params.fulltextMode || "both";
    const operator = params.fulltextOperator || "contains";
    const fulltextResult = await performFulltextSearch(params.fulltext, libraryID, mode, operator);
    fulltextItemIDs = fulltextResult.itemIDs;
    fulltextMatchDetails = fulltextResult.matchDetails;

    if (fulltextItemIDs.length === 0) {
      return {
        query: params,
        pagination: { limit, offset, total: 0, hasMore: false },
        searchTime: `${Date.now() - startTime}ms`,
        results: [],
        searchFeatures: ["fulltext"]
      };
    }
  }

  // --- 3.5. Special handling for standalone attachments, because Zotero.Search cannot reliably search attachment-type items ---
  if (params.itemType === "attachment") {
    // Use a clean search object to find all attachments, including child attachments, then filter standalone items in memory
    const attachSearch = new Zotero.Search();
    (attachSearch as any).libraryID = libraryID;
    attachSearch.addCondition("itemType", "is", "attachment");
    const attachIDs = await attachSearch.search();
    let standaloneItems = (await Zotero.Items.getAsync(attachIDs)).filter(
      (item: Zotero.Item) => !item.parentItemID
    );

    // If q is provided, do simple filtering by filename/title
    if (params.q) {
      const q = params.q.toLowerCase();
      standaloneItems = standaloneItems.filter((item: Zotero.Item) => {
        const title = (
          (item.getField("title") as string) ||
          item.attachmentFilename ||
          ""
        ).toLowerCase();
        return title.includes(q);
      });
    }

    const total = standaloneItems.length;
    const paginated = standaloneItems.slice(offset, offset + limit);
    const results = paginated.map((item: Zotero.Item) => {
      const formatted = formatItemBrief(item);
      formatted.attachments = [
        {
          key: item.key,
          filename: item.attachmentFilename || "",
          filePath: item.getFilePath() || "",
          contentType: item.attachmentContentType || "",
          linkMode: item.attachmentLinkMode,
        },
      ];
      return formatted;
    });

    return {
      query: params,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + paginated.length < total,
      },
      searchTime: `${Date.now() - startTime}ms`,
      results,
      searchFeatures: ["standalone_attachments"],
    };
  }

  // --- 4. Build Zotero search conditions, excluding tags ---
  const s = new Zotero.Search();
  (s as any).libraryID = libraryID;

  // Normal search conditions
  if (params.q) {
    s.addCondition("quicksearch-everything", "contains", params.q);
  }

  const fieldMappings: { [key in keyof SearchParams]?: string } = {
    title: "title",
    creator: "creator",
    year: "date",
    itemType: "itemType",
    doi: "DOI",
    isbn: "ISBN",
  };

  // Backwards compatibility: if old `tag` is provided without new `tags`, use Zotero native tag search
  if (params.tag && !params.tags) {
    fieldMappings.tag = "tag";
  }

  for (const [paramKey, conditionKey] of Object.entries(fieldMappings)) {
    const value = params[paramKey as keyof SearchParams];
    if (value) {
      const operator = ["year", "itemType"].includes(paramKey)
        ? "is"
        : "contains";
      s.addCondition(conditionKey, operator, value as string);
    }
  }

  if (params.collection) {
    const collection = await Zotero.Collections.getByLibraryAndKeyAsync(
      libraryID,
      params.collection,
    );
    if (collection) {
      s.addCondition("collection", "is", collection.id);
    } else {
      return {
        // Invalid collection, return empty results
        query: params,
        pagination: { limit, offset, total: 0, hasMore: false },
        searchTime: `${Date.now() - startTime}ms`,
        results: [],
      };
    }
  }

  if (params.hasAttachment)
    s.addCondition("attachment", "is", params.hasAttachment);
  if (params.hasNote) s.addCondition("note", "is", params.hasNote);
  if (params.includeAttachments !== "true")
    s.addCondition("itemType", "isNot", "attachment");
  if (params.includeNotes !== "true")
    s.addCondition("itemType", "isNot", "note");

  // --- 4. Execute initial search ---
  let initialItemIDs: number[];
  
  if (params.fulltext && fulltextItemIDs.length > 0) {
    // Use full-text search results when full-text search is specified
    initialItemIDs = fulltextItemIDs;
  } else {
    // Otherwise execute regular search
    initialItemIDs = await s.search();
  }
  
  if (initialItemIDs.length === 0) {
    return {
      query: params,
      pagination: { limit, offset, total: 0, hasMore: false },
      searchTime: `${Date.now() - startTime}ms`,
      results: [],
    };
  }

  // --- 5. Determine whether memory filtering/sorting is needed ---
  const queryTags = Array.isArray(params.tags)
    ? params.tags
    : params.tags
      ? [params.tags]
      : [];
  const matchedTagsStats: Record<string, number> = {};

  const advancedFilterKeys = [
    "yearRange", "dateAddedRange", "dateModifiedRange", "numPagesRange",
    "titleOperator", "creatorOperator", "abstractOperator",
    "publicationTitleOperator", "language", "rights", "url", "extra",
  ];
  const needsInMemoryFiltering =
    queryTags.length > 0 ||
    params.relevanceScoring === "true" ||
    sort === "relevance" ||
    Object.keys(params).some((key) => advancedFilterKeys.includes(key));

  const useRelevanceScoring =
    params.relevanceScoring === "true" || sort === "relevance";
  let scoredItems: ScoredItem[] = [];
  let items: Zotero.Item[];

  if (!needsInMemoryFiltering) {
    // --- Fast path: no memory filtering, process at ID level where possible ---
    const canSortByID = sort === "dateAdded" || sort === "dateModified";

    if (canSortByID) {
      // dateAdded/dateModified can use the approximate insertion order from IDs
      if (direction === "desc") {
        initialItemIDs.reverse();
      }
      const paginatedIDs = initialItemIDs.slice(offset, offset + limit);
      items = await Zotero.Items.getAsync(paginatedIDs);
    } else {
      // Other sort fields require loading items, with a cap
      const cappedIDs = initialItemIDs.slice(0, Math.min(initialItemIDs.length, 2000));
      items = await Zotero.Items.getAsync(cappedIDs);
      // Use precomputed sort keys (Schwartzian transform)
      items = await sortItemsWithYield(items, sort, direction);
    }
  } else {
    // --- Slow path: memory filtering required, load all ---
    items = await Zotero.Items.getAsync(initialItemIDs);

    // Tag filtering, using a for loop plus yield
    if (queryTags.length > 0) {
      const tagMatch = params.tagMatch || "exact";
      const tagMode = params.tagMode || "any";

      const filteredItems: Zotero.Item[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemTags = item.getTags().map((t) => t.tag);
        const matchedTags: string[] = [];

        for (const queryTag of queryTags) {
          const isMatch = itemTags.some((itemTag) => {
            switch (tagMatch) {
              case "contains":
                return itemTag.toLowerCase().includes(queryTag.toLowerCase());
              case "startsWith":
                return itemTag.toLowerCase().startsWith(queryTag.toLowerCase());
              case "exact":
              default:
                return itemTag.toLowerCase() === queryTag.toLowerCase();
            }
          });
          if (isMatch) {
            matchedTags.push(queryTag);
          }
        }

        const uniqueMatched = [...new Set(matchedTags)];
        let shouldInclude = false;
        switch (tagMode) {
          case "all":
            shouldInclude = uniqueMatched.length === queryTags.length;
            break;
          case "none":
            shouldInclude = uniqueMatched.length === 0;
            break;
          case "any":
          default:
            shouldInclude = uniqueMatched.length > 0;
            break;
        }

        if (shouldInclude) {
          (item as any).matchedTags = uniqueMatched;
          filteredItems.push(item);
          uniqueMatched.forEach((tag) => {
            matchedTagsStats[tag] = (matchedTagsStats[tag] || 0) + 1;
          });
        }

        // Yield to the main thread every 100 items
        if (i > 0 && i % 100 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      items = filteredItems;
    }

    // Apply advanced filters
    if (Object.keys(params).some((key) => advancedFilterKeys.includes(key))) {
      items = applyAdvancedFilters(items, params);
    }

    // --- 6. Relevance scoring and sorting ---
    if (useRelevanceScoring) {
      if (sort === "relevance") {
        // Sort by relevance: score all items before sorting
        scoredItems = items.map((item) => {
          const { score, matchedFields } = calculateRelevanceScore(item, params);
          return { item, relevanceScore: score, matchedFields };
        });
        scoredItems.sort((a, b) => {
          return direction === "asc"
            ? a.relevanceScore - b.relevanceScore
            : b.relevanceScore - a.relevanceScore;
        });
        items = scoredItems.map((si) => si.item);
      } else {
        // Non-relevance sorting: sort first, then score after pagination
        items = await sortItemsWithYield(items, sort, direction);
      }
    } else {
      items = await sortItemsWithYield(items, sort, direction);
    }
  }

  // --- 7. Pagination and formatting ---
  // Fast-path items may already be paginated, so use initialItemIDs.length as total count
  const isFastPathPaginated = !needsInMemoryFiltering && (sort === "dateAdded" || sort === "dateModified");
  const total = isFastPathPaginated ? initialItemIDs.length : items.length;
  const paginatedItems = isFastPathPaginated ? items : items.slice(offset, offset + limit);

  // Prebuild score map to avoid O(n) find
  const scoreMap = useRelevanceScoring
    ? new Map(scoredItems.map((si) => [si.item.id, si]))
    : null;

  const results: Record<string, any>[] = [];
  for (let i = 0; i < paginatedItems.length; i++) {
    const item = paginatedItems[i];
    const formatted = formatItemBrief(item);

    // Add attachment information without filePath to avoid synchronous file I/O
    try {
      const attachmentIDs = item.getAttachments();
      if (attachmentIDs && attachmentIDs.length > 0) {
        // Limit each item to at most 3 attachments
        const cappedIDs = attachmentIDs.slice(0, 3);
        const attachments: any[] = [];
        for (const id of cappedIDs) {
          const attachment = Zotero.Items.get(id);
          if (attachment && attachment.isAttachment()) {
            attachments.push({
              key: attachment.key,
              filename: attachment.attachmentFilename || '',
              contentType: attachment.attachmentContentType || '',
              linkMode: attachment.attachmentLinkMode
            });
          }
        }
        formatted.attachments = attachments;
        if (attachmentIDs.length > 3) {
          formatted.attachmentsTruncated = true;
          formatted.totalAttachments = attachmentIDs.length;
        }
      } else {
        formatted.attachments = [];
      }
    } catch (error) {
      ztoolkit.log(`[SearchEngine] Error getting attachments for item ${item.key}: ${error}`, "warn");
      formatted.attachments = [];
    }

    // Add tag match information
    if ((item as any).matchedTags) {
      formatted.matchedTags = (item as any).matchedTags;
    }

    // Add relevance score information
    if (useRelevanceScoring) {
      if (scoreMap) {
        // sort=relevance uses precomputed scores
        const scoredItem = scoreMap.get(item.id);
        if (scoredItem) {
          formatted.relevanceScore = scoredItem.relevanceScore;
          formatted.matchedFields = scoredItem.matchedFields;
        }
      } else {
        // Non-relevance sorting: defer scoring until after pagination, only scoring current-page items
        const { score, matchedFields } = calculateRelevanceScore(item, params);
        formatted.relevanceScore = score;
        formatted.matchedFields = matchedFields;
      }
    }

    // Add full-text search match details
    if (params.fulltext && fulltextMatchDetails.has(item.id)) {
      const matchDetails = fulltextMatchDetails.get(item.id);
      formatted.fulltextMatch = {
        query: params.fulltext,
        mode: params.fulltextMode || "both",
        attachments: matchDetails.attachments || [],
        notes: matchDetails.notes || [],
        totalScore: matchDetails.score || 0
      };
    }

    results.push(formatted);

    // Yield to the main thread every 5 items to avoid UI freezes
    if (i > 0 && i % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // --- 8. Return final result ---
  const response: Record<string, any> = {
    query: params,
    pagination: {
      limit,
      offset,
      total,
      hasMore: offset + limit < total,
    },
    searchTime: `${Date.now() - startTime}ms`,
    results,
  };

  // Add tag statistics
  if (Object.keys(matchedTagsStats).length > 0) {
    response.matchedTags = matchedTagsStats;
  }

  // Add advanced search statistics
  if (useRelevanceScoring) {
    response.relevanceStats = {
      averageScore:
        scoredItems.length > 0
          ? scoredItems.reduce((sum, item) => sum + item.relevanceScore, 0) /
            scoredItems.length
          : 0,
      maxScore:
        scoredItems.length > 0
          ? Math.max(...scoredItems.map((item) => item.relevanceScore))
          : 0,
      minScore:
        scoredItems.length > 0
          ? Math.min(...scoredItems.map((item) => item.relevanceScore))
          : 0,
    };
  }

  // Add search type information
  const searchFeatures: string[] = [];
  if (params.q) searchFeatures.push("fulltext");
  if (queryTags.length > 0) searchFeatures.push("tags");
  if (params.yearRange) searchFeatures.push("dateRange");
  if (
    params.titleOperator ||
    params.creatorOperator ||
    params.abstractOperator
  ) {
    searchFeatures.push("advancedOperators");
  }
  if (useRelevanceScoring) searchFeatures.push("relevanceScoring");

  response.searchFeatures = searchFeatures;
  response.version = "2.0"; // Mark as enhanced search engine

  return response;
}

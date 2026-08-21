const GOOGLE_ADS_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v24";
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v20.0";
const { normalizeSaLeadContactFields } = require("../validation/saLeadValidation");

const PROVIDER_CONFIG = {
  facebook: { label: "Meta Ads", family: "meta" },
  instagram: { label: "Meta Ads", family: "meta" },
  meta: { label: "Meta Ads", family: "meta" },
  google: { label: "Google Ads", family: "google" },
  linkedin: { label: "LinkedIn Ads", family: "linkedin" },
};

function normalizeProvider(platformType) {
  return String(platformType || "").trim().toLowerCase();
}

function providerFamily(platformType) {
  const key = normalizeProvider(platformType);
  return PROVIDER_CONFIG[key]?.family || key;
}

function providerLabel(platformType) {
  const key = normalizeProvider(platformType);
  return PROVIDER_CONFIG[key]?.label || platformType || "External Ads";
}

function parseJsonList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return String(value).split(",").map((v) => v.trim()).filter(Boolean);
  }
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseAccountDetails(platform) {
  return parseJsonObject(platform.AccountDetails || platform.accountDetails);
}

function cleanCustomerId(value) {
  return String(value || "").replace(/^customers\//, "").replace(/-/g, "").trim();
}

function statusToGoogle(status) {
  return String(status || "").toLowerCase() === "active" ? "ENABLED" : "PAUSED";
}

function statusToMeta(status) {
  return String(status || "").toLowerCase() === "active" ? "ACTIVE" : "PAUSED";
}

function buildAdPayload(ad) {
  return {
    id: ad.Id,
    name: ad.Name,
    externalAdId: ad.ExternalAdId,
    externalAdSetId: ad.ExternalAdSetId,
    campaign: {
      id: ad.CampaignId,
      name: ad.CampaignName,
      externalCampaignId: ad.ExternalCampaignId || null,
    },
    creative: {
      headline: ad.Headline,
      description: ad.Description,
      ctaText: ad.CtaText,
      imageUrl: ad.ImageUrl,
      videoUrl: ad.VideoUrl,
      mediaUrls: parseJsonList(ad.MediaUrls),
    },
    targeting: {
      ageMin: ad.TargetAgeMin,
      ageMax: ad.TargetAgeMax,
      gender: ad.TargetGender,
      locations: parseJsonList(ad.TargetLocations),
      radiusKm: ad.TargetRadiusKm,
      interests: parseJsonList(ad.TargetInterests),
      behaviors: parseJsonList(ad.TargetBehaviors),
      languages: parseJsonList(ad.TargetLanguages),
    },
    delivery: {
      placement: ad.PlatformPlacement,
      objective: ad.Objective,
      optimizationGoal: ad.OptimizationGoal,
      bidStrategy: ad.BidStrategy,
      destinationUrl: ad.DestinationUrl,
      utmParameters: parseJsonObject(ad.UtmParameters),
      budget: ad.Budget,
      dailySpend: ad.DailySpend,
      scheduledStartAt: ad.ScheduledStartAt,
      scheduledEndAt: ad.ScheduledEndAt,
      status: ad.Status,
    },
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await readJsonResponse(response);
    if (!response.ok) {
      const message = body?.error?.message || body?.message || response.statusText || "External API request failed";
      const err = new Error(message);
      err.status = response.status;
      err.body = body;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function googleHeaders(platform) {
  const settings = parseAccountDetails(platform);
  const developerToken = platform.DeveloperToken || settings.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) throw new Error("Google Ads developer token is required in AccountDetails.developerToken or GOOGLE_ADS_DEVELOPER_TOKEN");
  const headers = {
    Authorization: `Bearer ${platform.AccessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  const loginCustomerId = platform.LoginCustomerId || settings.loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (loginCustomerId) headers["login-customer-id"] = cleanCustomerId(loginCustomerId);
  return headers;
}

function metaUrl(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function testPlatformConnection(platformType, accessToken, adAccountId, platform = {}) {
  const family = providerFamily(platformType);
  if (!accessToken) return { ok: false, provider: providerLabel(platformType), message: "Access token is required." };

  try {
    if (family === "google") {
      const result = await requestJson(`https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers:listAccessibleCustomers`, {
        method: "GET",
        headers: googleHeaders({ ...platform, AccessToken: accessToken }),
      });
      return { ok: true, provider: "Google Ads", message: "Connection successful.", sample: result };
    }

    if (family === "meta") {
      const accountId = normalizeMetaAccountId(adAccountId);
      const result = await requestJson(metaUrl(accountId || "me", {
        access_token: accessToken,
        fields: accountId ? "id,name,account_status" : "id,name",
      }));
      return { ok: true, provider: "Meta Ads", message: "Connection successful.", sample: result };
    }

    return { ok: false, provider: providerLabel(platformType), message: `No production adapter is configured for ${platformType || "this platform"}.` };
  } catch (err) {
    return {
      ok: false,
      provider: providerLabel(platformType),
      status: err.status,
      message: err.message || "Connection failed.",
      sample: err.body || null,
    };
  }
}

function normalizeMetaAccountId(value) {
  if (!value) return "";
  const s = String(value).trim();
  return s.startsWith("act_") ? s : `act_${s}`;
}

function googleAdGroupResource(ad, platform) {
  const settings = parseAccountDetails(platform);
  const explicit = ad.ExternalAdSetId || settings.adGroupResourceName;
  if (explicit && String(explicit).startsWith("customers/")) return explicit;
  const customerId = cleanCustomerId(platform.AdAccountId || settings.customerId);
  const adGroupId = explicit || settings.adGroupId;
  if (!customerId || !adGroupId) {
    throw new Error("Google push requires AdAccountId/customerId and ExternalAdSetId or AccountDetails.adGroupId.");
  }
  return `customers/${customerId}/adGroups/${String(adGroupId).trim()}`;
}

function googleAdTextAssets(values, fallback) {
  const list = values.filter(Boolean).map((text) => ({ text: String(text).slice(0, 90) }));
  return list.length ? list : [{ text: fallback || "New offer" }];
}

async function pushGoogleAd(ad, platform) {
  const settings = parseAccountDetails(platform);
  const customerId = cleanCustomerId(platform.AdAccountId || settings.customerId);
  if (!customerId) throw new Error("Google Ads customer ID is required in AdAccountId or AccountDetails.customerId.");

  const finalUrl = ad.DestinationUrl || settings.finalUrl;
  if (!finalUrl) throw new Error("Google push requires DestinationUrl/finalUrl.");

  const body = {
    operations: [{
      create: {
        adGroup: googleAdGroupResource(ad, platform),
        status: statusToGoogle(ad.Status),
        ad: {
          finalUrls: [finalUrl],
          responsiveSearchAd: {
            headlines: googleAdTextAssets([ad.Headline, ad.Name, ad.CtaText], ad.Name),
            descriptions: googleAdTextAssets([ad.Description, ad.CreativeRef], ad.Name).slice(0, 4),
          },
        },
      },
    }],
    partialFailure: true,
  };

  const result = await requestJson(`https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers/${customerId}/adGroupAds:mutate`, {
    method: "POST",
    headers: googleHeaders(platform),
    body: JSON.stringify(body),
  });
  const resourceName = result?.results?.[0]?.resourceName || null;
  return {
    status: resourceName ? "Success" : "Partial",
    provider: "Google Ads",
    externalAdId: resourceName || ad.ExternalAdId || null,
    message: resourceName ? "Google ad created." : "Google Ads accepted the request with partial result.",
    rawResponse: { request: body, response: result },
  };
}

async function pushMetaAd(ad, platform) {
  const settings = parseAccountDetails(platform);
  const accountId = normalizeMetaAccountId(platform.AdAccountId || settings.adAccountId);
  const adsetId = ad.ExternalAdSetId || settings.adsetId;
  const pageId = settings.pageId || platform.PixelId;
  const link = ad.DestinationUrl || settings.link;
  if (!accountId) throw new Error("Meta push requires AdAccountId.");
  if (!adsetId) throw new Error("Meta push requires ExternalAdSetId or AccountDetails.adsetId.");
  if (!pageId) throw new Error("Meta push requires AccountDetails.pageId or PixelId.");
  if (!link) throw new Error("Meta push requires DestinationUrl or AccountDetails.link.");

  const creativeBody = {
    access_token: platform.AccessToken,
    name: `${ad.Name} Creative`,
    object_story_spec: {
      page_id: pageId,
      link_data: {
        link,
        message: ad.Description || ad.CreativeRef || ad.Name,
        name: ad.Headline || ad.Name,
        call_to_action: ad.CtaText ? { type: normalizeMetaCta(ad.CtaText), value: { link } } : undefined,
        picture: ad.ImageUrl || undefined,
      },
    },
  };
  const creative = await requestJson(metaUrl(`${accountId}/adcreatives`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creativeBody),
  });

  const adBody = {
    access_token: platform.AccessToken,
    name: ad.Name,
    adset_id: adsetId,
    creative: { creative_id: creative.id },
    status: statusToMeta(ad.Status),
  };
  const result = await requestJson(metaUrl(`${accountId}/ads`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(adBody),
  });

  return {
    status: result.id ? "Success" : "Partial",
    provider: "Meta Ads",
    externalAdId: result.id || ad.ExternalAdId || null,
    message: result.id ? "Meta ad created." : "Meta Ads accepted the request with partial result.",
    rawResponse: { creativeRequest: creativeBody, creativeResponse: creative, adRequest: adBody, adResponse: result },
  };
}

function normalizeMetaCta(value) {
  const key = String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const allowed = new Set(["LEARN_MORE", "SIGN_UP", "CONTACT_US", "BOOK_NOW", "APPLY_NOW", "GET_QUOTE", "SEND_MESSAGE", "CALL_NOW"]);
  if (allowed.has(key)) return key;
  if (key.includes("CALL")) return "CALL_NOW";
  if (key.includes("SIGN")) return "SIGN_UP";
  if (key.includes("CONTACT")) return "CONTACT_US";
  return "LEARN_MORE";
}

async function syncAdToPlatform(ad, platform, mode = "Preview") {
  const payload = buildAdPayload(ad);
  const provider = providerLabel(platform.PlatformType);
  const hasCredentials = Boolean(platform.AccessToken && platform.AdAccountId && platform.ApiEnabled);
  if (mode === "Preview" || !hasCredentials) {
    return {
      status: "Pending",
      provider,
      externalAdId: ad.ExternalAdId || null,
      message: hasCredentials ? "Sync payload prepared. Use Push mode to send it." : "API credentials are not enabled for this platform.",
      metrics: {},
      rawResponse: payload,
    };
  }

  const family = providerFamily(platform.PlatformType);
  if (family === "google") return pushGoogleAd(ad, platform);
  if (family === "meta") return pushMetaAd(ad, platform);
  throw new Error(`No production push adapter is configured for ${provider}.`);
}

// Escape a string value for safe embedding inside a GAQL single-quoted literal.
// GAQL does not support backslash escaping — the only special character inside
// a single-quoted string is the single-quote itself, which must be doubled ('').
// Backslashes are also doubled so they are treated as literal characters.
// Reference: https://developers.google.com/google-ads/api/docs/query/grammar
function escapeGaqlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "''");
}

async function fetchGoogleMetrics(ad, platform, dateRange = "LAST_30_DAYS") {
  const settings = parseAccountDetails(platform);
  const customerId = cleanCustomerId(platform.AdAccountId || settings.customerId);
  if (!customerId) throw new Error("Google Ads customer ID is required.");
  const external = String(ad.ExternalAdId || "");
  const where = external.startsWith("customers/")
    ? `ad_group_ad.resource_name = '${escapeGaqlString(external)}'`
    : external && Number.isFinite(Number(external))
      ? `ad_group_ad.ad.id = ${Number(external)}`
      : `ad_group.name = '${escapeGaqlString(String(ad.Name || ""))}'`;
  const query = `
    SELECT ad_group_ad.resource_name, ad_group_ad.ad.id, metrics.impressions,
           metrics.clicks, metrics.cost_micros, metrics.conversions,
           metrics.ctr, metrics.average_cpc, metrics.average_cpm
    FROM ad_group_ad
    WHERE ${where}
      AND segments.date DURING ${dateRange}
  `;
  const result = await requestJson(`https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: googleHeaders(platform),
    body: JSON.stringify({ query }),
  });
  const rows = Array.isArray(result) ? result.flatMap((chunk) => chunk.results || []) : result.results || [];
  return aggregateGoogleRows(rows, { query, raw: result });
}

function aggregateGoogleRows(rows, rawResponse) {
  const totals = rows.reduce((acc, row) => {
    const m = row.metrics || {};
    acc.impressions += Number(m.impressions || 0);
    acc.clicks += Number(m.clicks || 0);
    acc.spend += Number(m.costMicros || m.cost_micros || 0) / 1000000;
    acc.conversions += Number(m.conversions || 0);
    acc.ctr = Number(m.ctr || acc.ctr || 0);
    acc.cpc = Number(m.averageCpc || m.average_cpc || 0) / 1000000;
    acc.cpm = Number(m.averageCpm || m.average_cpm || 0) / 1000000;
    return acc;
  }, { impressions: 0, clicks: 0, spend: 0, conversions: 0, ctr: 0, cpc: 0, cpm: 0 });
  return { provider: "Google Ads", metrics: totals, rawResponse };
}

async function fetchMetaMetrics(ad, platform, datePreset = "last_30d") {
  const adId = ad.ExternalAdId;
  if (!adId) throw new Error("Meta metrics require ExternalAdId.");
  const result = await requestJson(metaUrl(`${adId}/insights`, {
    access_token: platform.AccessToken,
    date_preset: datePreset,
    fields: "impressions,clicks,spend,reach,frequency,ctr,cpc,cpm,actions,cost_per_action_type",
  }));
  const row = result?.data?.[0] || {};
  const leads = actionValue(row.actions, "lead");
  const metrics = {
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    spend: Number(row.spend || 0),
    reach: Number(row.reach || 0),
    frequency: Number(row.frequency || 0),
    ctr: Number(row.ctr || 0),
    cpc: Number(row.cpc || 0),
    cpm: Number(row.cpm || 0),
    conversions: leads,
    leadsGenerated: leads,
    costPerLead: actionValue(row.cost_per_action_type, "lead"),
  };
  return { provider: "Meta Ads", metrics, rawResponse: result };
}

function actionValue(actions = [], contains) {
  const item = (Array.isArray(actions) ? actions : []).find((a) => String(a.action_type || "").toLowerCase().includes(contains));
  return Number(item?.value || 0);
}

async function fetchAdMetrics(ad, platform, range) {
  const family = providerFamily(platform.PlatformType);
  if (family === "google") return fetchGoogleMetrics(ad, platform, range || "LAST_30_DAYS");
  if (family === "meta") return fetchMetaMetrics(ad, platform, range || "last_30d");
  throw new Error(`No metrics adapter is configured for ${providerLabel(platform.PlatformType)}.`);
}

async function fetchLeadsFromPlatform(ad, platform) {
  const family = providerFamily(platform.PlatformType);
  if (family !== "meta") {
    return { provider: providerLabel(platform.PlatformType), leads: [], rawResponse: { message: "Lead form pull is supported for Meta Lead Ads only in this adapter." } };
  }
  const settings = parseAccountDetails(platform);
  const formId = settings.leadFormId || ad.LeadFormId || ad.ExternalLeadFormId || null;
  const objectId = formId || ad.ExternalAdId;
  if (!objectId) throw new Error("Meta lead pull requires AccountDetails.leadFormId or ad ExternalAdId.");
  const result = await requestJson(metaUrl(`${objectId}/leads`, {
    access_token: platform.AccessToken,
    fields: "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data",
    limit: 100,
  }));
  const leads = (result.data || []).map((lead) => normalizeMetaLead(lead));
  return { provider: "Meta Ads", leads, rawResponse: result };
}

function normalizeMetaLead(lead) {
  const fields = {};
  (lead.field_data || []).forEach((field) => {
    fields[field.name] = Array.isArray(field.values) ? field.values[0] : field.values;
  });
  return {
    ExternalLeadId: lead.id,
    CustomerName: fields.full_name || fields.name || fields.first_name || null,
    Mobile: fields.phone_number || fields.phone || fields.mobile || null,
    Email: fields.email || null,
    LeadFormName: lead.form_id || null,
    SourceCampaignName: lead.campaign_name || null,
    SourceAdName: lead.ad_name || null,
    CapturedAt: lead.created_time || new Date().toISOString(),
    SourcePayload: lead,
  };
}

async function normalizeImportedLeads(ad, platform, importedLeads = []) {
  return importedLeads.map((lead, index) => {
    const normalized = normalizeSaLeadContactFields({
      CustomerName: lead.CustomerName || lead.name || lead.full_name || lead.Customer || null,
      Mobile: lead.Mobile || lead.phone || lead.phone_number || lead.mobile || null,
      Email: lead.Email || lead.email || null,
    });

    return {
      ExternalLeadId: lead.ExternalLeadId || lead.externalLeadId || lead.id || `${providerLabel(platform.PlatformType)}-${ad.Id}-${Date.now()}-${index}`,
      CustomerName: normalized.value.CustomerName,
      Mobile: normalized.value.Mobile,
      Email: normalized.value.Email,
      ValidationErrors: normalized.errors,
      SourceType: "Ad",
      PlatformId: platform.Id,
      CampaignId: ad.CampaignId,
      AdId: ad.Id,
      LeadFormName: lead.LeadFormName || lead.form_name || lead.form_id || null,
      SourceCampaignName: lead.SourceCampaignName || lead.campaign_name || null,
      SourceAdName: lead.SourceAdName || lead.ad_name || null,
      CapturedAt: lead.CapturedAt || lead.created_time || new Date().toISOString(),
      SourcePayload: lead.SourcePayload || lead,
    };
  });
}

module.exports = {
  providerLabel,
  testPlatformConnection,
  syncAdToPlatform,
  fetchAdMetrics,
  fetchLeadsFromPlatform,
  normalizeImportedLeads,
};

import React, { useState, useEffect, useRef } from 'react';
import { ndliSearch, getBackendApiInfo } from '../services/ndliSearch';

// ─── Icons (inline SVGs to avoid dependencies) ───────────────────────────────
const SearchIcon = ({ className = "w-5 h-5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true" focusable="false">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
);

const SparklesIcon = ({ className = "w-5 h-5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} aria-hidden="true" focusable="false">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
);

const BookIcon = ({ className = "w-5 h-5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} aria-hidden="true" focusable="false">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
);

const UserIcon = ({ className = "w-4 h-4" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true" focusable="false">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
);

const ExternalLinkIcon = ({ className = "w-3.5 h-3.5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true" focusable="false">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
);

const XIcon = ({ className = "w-4 h-4" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true" focusable="false">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);

// ─── Domain config with emoji icons ──────────────────────────────────────────
const DOMAINS = [
    { key: 'se', label: 'School Education', emoji: '🎒' },
    { key: 'he', label: 'Higher Education', emoji: '🎓' },
    { key: 'cd', label: 'Career Development', emoji: '💼' },
    { key: 'rs', label: 'Research', emoji: '🔬' },
    { key: 'ps', label: 'Patents & Standards', emoji: '📜' },
    { key: 'jr', label: 'Judicial Resources', emoji: '⚖️' },
    { key: 'ca', label: 'Cultural Archives', emoji: '🏛️' },
    { key: 'na', label: 'Newspaper Archives', emoji: '📰' },
];

const SEARCH_STATUS_ID = 'search-status';
const SEARCH_ERROR_ID = 'search-error-message';
const SEARCH_RESULTS_HEADING_ID = 'search-results-heading';
const SEARCH_INPUT_ID = 'search-input';
const BACKEND_API_INFO = getBackendApiInfo();

function formatTimestamp(timestamp) {
    if (!timestamp) return '';

    return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function backendIssueHint(errorCode) {
    switch (errorCode) {
        case 'CORS_BLOCKED':
            return 'Frontend origin is blocked by backend CORS settings.';
        case 'BACKEND_UNREACHABLE':
            return 'Backend domain is unreachable from this network right now.';
        case 'BACKEND_TIMEOUT':
            return 'Backend API request timed out before receiving a response.';
        case 'NDLI_UPSTREAM_TIMEOUT':
            return 'Backend is reachable, but NDLI upstream timed out.';
        case 'NDLI_UPSTREAM_UNREACHABLE':
            return 'Backend is reachable, but cannot connect to NDLI upstream.';
        case 'BACKEND_SEARCH_ROUTE_ISSUE':
            return 'Backend health is reachable, but /api/search failed.';
        default:
            return '';
    }
}

function normalizeResultType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'other';

    return raw.replace(/\s+/g, '-');
}

function resultTypeLabel(typeKey) {
    if (!typeKey || typeKey === 'all') return 'All';
    if (typeKey === 'other') return 'Other';

    return typeKey
        .split('-')
        .filter(Boolean)
        .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
        .join(' ');
}

function summarizerBadgeConfig(status) {
    switch (status) {
        case 'up':
            return {
                label: 'Summarizer: Up',
                className: 'text-sky-700 bg-sky-50 border-sky-100',
            };
        case 'down':
            return {
                label: 'Summarizer: Down',
                className: 'text-rose-700 bg-rose-50 border-rose-100',
            };
        case 'disabled':
            return {
                label: 'Summarizer: Off',
                className: 'text-slate-600 bg-slate-100 border-slate-200',
            };
        default:
            return {
                label: 'Summarizer: Unknown',
                className: 'text-slate-500 bg-slate-100 border-slate-200',
            };
    }
}

    function normalizeAiSummaryText(value) {
        return String(value || '')
        .toLowerCase()
        .replace(/\[\d+\]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

// ─── Skeleton loading components ─────────────────────────────────────────────
const AISkeleton = () => (
    <div className="ai-card-border p-6 mb-8 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-4">
            <div className="skeleton w-9 h-9 rounded-xl" />
            <div className="skeleton w-48 h-5" />
        </div>
        <div className="space-y-2.5">
            <div className="skeleton w-full h-4" />
            <div className="skeleton w-full h-4" />
            <div className="skeleton w-3/4 h-4" />
        </div>
        <div className="mt-5 pt-4 border-t border-gray-100 space-y-2">
            <div className="skeleton w-24 h-3" />
            <div className="skeleton w-64 h-3.5" />
            <div className="skeleton w-56 h-3.5" />
            <div className="skeleton w-60 h-3.5" />
        </div>
    </div>
);

const ResultSkeleton = () => (
    <div className="space-y-3 animate-fade-in">
        {[...Array(4)].map((_, i) => (
            <div key={`skel-${i}`} className="bg-white rounded-xl p-5 border border-gray-100">
                <div className="skeleton w-3/5 h-5 mb-3" />
                <div className="skeleton w-32 h-3 mb-3" />
                <div className="space-y-1.5">
                    <div className="skeleton w-full h-3.5" />
                    <div className="skeleton w-4/5 h-3.5" />
                </div>
            </div>
        ))}
    </div>
);

// ─── Main Component ──────────────────────────────────────────────────────────
export default function Home() {
    const [q, setQ] = useState('');
    const [results, setResults] = useState([]);
    const [aiCard, setAiCard] = useState(null);
    const [selectedDomain, setSelectedDomain] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [searchPerformed, setSearchPerformed] = useState(false);
    const [retryTick, setRetryTick] = useState(0);
    const [activeResultType, setActiveResultType] = useState('all');
    const [apiRequestState, setApiRequestState] = useState(null);
    const [alwaysShowNarrative, setAlwaysShowNarrative] = useState(false);
    const inputRef = useRef(null);

    // Debounced NDLI search
    useEffect(() => {
        const queryText = q.trim();
        if (!queryText || !selectedDomain) {
            setResults([]);
            setAiCard(null);
            setError(null);
            setSearchPerformed(false);
            setActiveResultType('all');
            setApiRequestState(null);
            return;
        }

        const timeoutId = setTimeout(async () => {
            setLoading(true);
            setError(null);
            setSearchPerformed(true);

            try {
                console.log('🔍 Searching NDLI for:', queryText, 'in domain:', selectedDomain);
                const data = await ndliSearch(queryText, selectedDomain);
                console.log('📦 NDLI API Response:', data);

                const rows = data.rows || [];
                const requestMeta = data && typeof data === 'object' ? data._requestMeta : null;
                setResults(rows);
                setActiveResultType('all');
                setApiRequestState({
                    status: 'success',
                    at: Date.now(),
                    count: rows.length,
                    endpoint: requestMeta?.searchEndpoint || BACKEND_API_INFO.searchEndpoint || '/api/search',
                    host: requestMeta?.host || BACKEND_API_INFO.host || BACKEND_API_INFO.baseUrl || 'unknown-backend',
                    errorCode: null,
                });

                const fallbackSources = rows.slice(0, 3).map((r, index) => ({
                    title: r.title,
                    url: r.url || '#',
                    author: r.author || 'NDLI',
                    ref: index + 1,
                }));

                const backendOverview = data.aiOverview;
                const backendMeta = backendOverview?.meta || null;
                const backendSentenceDetails = Array.isArray(backendOverview?.sentenceDetails)
                    ? backendOverview.sentenceDetails
                        .map((item) => {
                            if (!item) return null;

                            const text = String(item.text || '').trim();
                            if (!text) return null;

                            const numericSourceRef = Number(item.sourceRef);
                            const sourceRef = Number.isFinite(numericSourceRef) && numericSourceRef > 0
                                ? numericSourceRef
                                : null;
                            const numericConfidence = Number(item.confidence);

                            return {
                                text,
                                sourceRef,
                                citation: sourceRef ? `[${sourceRef}]` : '',
                                confidence: Number.isFinite(numericConfidence)
                                    ? Math.max(0, Math.min(1, numericConfidence))
                                    : null,
                            };
                        })
                        .filter(Boolean)
                        .slice(0, 4)
                    : [];
                const backendSentences = backendSentenceDetails.length
                    ? backendSentenceDetails.map((item) => item.text)
                    : (Array.isArray(backendOverview?.sentences)
                        ? backendOverview.sentences.filter(Boolean).slice(0, 4)
                        : []);
                const backendSnippet = backendOverview?.snippet ||
                    (Array.isArray(backendOverview?.sentences) ? backendOverview.sentences.join(' ') : '');
                const backendSources = Array.isArray(backendOverview?.sources) && backendOverview.sources.length
                    ? backendOverview.sources.slice(0, 4).map((source, index) => {
                        const numericRef = Number(source?.ref);
                        const ref = Number.isFinite(numericRef) && numericRef > 0
                            ? numericRef
                            : index + 1;

                        return {
                            title: source?.title || 'NDLI Source',
                            url: source?.url || '#',
                            author: source?.author || 'NDLI',
                            ref,
                        };
                    })
                    : fallbackSources;

                if (backendSnippet) {
                    const sentenceDetails = backendSentenceDetails.length
                        ? backendSentenceDetails
                        : backendSentences.map((text) => ({
                            text,
                            sourceRef: null,
                            citation: '',
                            confidence: null,
                        }));

                    setAiCard({
                        snippet: backendSnippet,
                        sentences: backendSentences,
                        sentenceDetails,
                        sources: backendSources,
                        summarizerStatus: backendMeta?.summarizer || 'unknown',
                    });
                } else if (rows.length) {
                    const fallbackSnippet = rows.map(r => r.desc || r.title).slice(0, 3).join(' ');
                    const fallbackSentences = fallbackSnippet
                        .split(/(?<=[.!?])\s+/)
                        .map((sentence) => sentence.trim())
                        .filter(Boolean)
                        .slice(0, 3);

                    setAiCard({
                        snippet: fallbackSnippet.slice(0, 500) + (fallbackSnippet.length > 500 ? '...' : ''),
                        sentences: fallbackSentences,
                        sentenceDetails: fallbackSentences.map((text, index) => {
                            const sourceRef = index < fallbackSources.length ? index + 1 : null;
                            return {
                                text,
                                sourceRef,
                                citation: sourceRef ? `[${sourceRef}]` : '',
                                confidence: null,
                            };
                        }),
                        sources: fallbackSources,
                        summarizerStatus: backendMeta?.summarizer || 'unknown',
                    });
                } else {
                    setAiCard(null);
                }
            } catch (err) {
                console.error('❌ NDLI search failed:', err);
                const errorApiInfo = err?.apiInfo;
                setError(err.message || 'Search failed. Please try again.');
                setResults([]);
                setAiCard(null);
                setApiRequestState({
                    status: 'error',
                    at: Date.now(),
                    count: 0,
                    endpoint: errorApiInfo?.searchEndpoint || BACKEND_API_INFO.searchEndpoint || '/api/search',
                    host: errorApiInfo?.host || BACKEND_API_INFO.host || BACKEND_API_INFO.baseUrl || 'unknown-backend',
                    errorCode: typeof err?.code === 'string' ? err.code : 'UNKNOWN_ERROR',
                });
            } finally {
                setLoading(false);
            }
        }, 600);

        return () => clearTimeout(timeoutId);
    }, [q, selectedDomain, retryTick]);

    useEffect(() => {
        if (activeResultType === 'all') return;

        const hasActiveType = results.some((item) => normalizeResultType(item?.type) === activeResultType);
        if (!hasActiveType) {
            setActiveResultType('all');
        }
    }, [results, activeResultType]);

    const activeDomainLabel = DOMAINS.find(d => d.key === selectedDomain)?.label;
    const trimmedQuery = q.trim();
    const showInitialHero = !searchPerformed && !trimmedQuery;
    const canRetry = Boolean(trimmedQuery && selectedDomain && !loading);

    const typeCountMap = results.reduce((acc, item) => {
        const key = normalizeResultType(item?.type);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    const resultTypeOptions = [
        { key: 'all', label: 'All', count: results.length },
        ...Object.entries(typeCountMap)
            .sort((a, b) => b[1] - a[1])
            .map(([key, count]) => ({
                key,
                label: resultTypeLabel(key),
                count,
            })),
    ];

    const filteredResults = activeResultType === 'all'
        ? results
        : results.filter((item) => normalizeResultType(item?.type) === activeResultType);
    const hasResults = results.length > 0;
    const hasFilteredResults = filteredResults.length > 0;
    const apiEndpointLabel = apiRequestState?.endpoint || BACKEND_API_INFO.searchEndpoint || '/api/search';
    const apiSuccessTimeLabel = formatTimestamp(apiRequestState?.at);
    const apiErrorHint = apiRequestState?.status === 'error'
        ? backendIssueHint(apiRequestState?.errorCode)
        : '';

    const retrySearch = () => {
        if (!canRetry) return;
        setRetryTick((prev) => prev + 1);
    };

    const statusMessage = loading
        ? `Calling backend API for ${activeDomainLabel || 'selected domain'} resources...`
        : error
            ? 'Search failed. Check your backend connection and retry.'
            : searchPerformed && results.length > 0
                ? `${filteredResults.length} of ${results.length} results in ${activeDomainLabel || 'selected domain'}${activeResultType !== 'all' ? ` (${resultTypeLabel(activeResultType)})` : ''} via backend API`
                : searchPerformed && trimmedQuery
                    ? `No results for "${trimmedQuery}"`
                    : selectedDomain
                        ? `${activeDomainLabel} selected. Start typing to search.`
                        : 'Choose a domain to enable search.';
    const searchDescriptionIds = error ? `${SEARCH_STATUS_ID} ${SEARCH_ERROR_ID}` : SEARCH_STATUS_ID;

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#eaf2ff_0%,_#f8fafc_42%,_#ffffff_100%)] text-slate-800">
            {/* Top bar */}
            <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/88 backdrop-blur-lg">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-[#0b57d0] flex items-center justify-center shadow-sm shadow-blue-500/25">
                            <BookIcon className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-slate-900 leading-tight tracking-tight">NDLI Search</h1>
                            <p className="text-[11px] text-slate-500 font-medium -mt-0.5">National Digital Library of India</p>
                        </div>
                    </div>
                    {activeDomainLabel && (
                        <span className="text-xs font-semibold text-[#0b57d0] bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100 animate-fade-in">
                            {activeDomainLabel}
                        </span>
                    )}
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 sm:px-6 pb-10" aria-busy={loading}>
                {/* Hero / domain setup */}
                {showInitialHero && (
                    <section className="pt-14 pb-6 animate-fade-in-up" aria-label="Search setup">
                        <div className="text-center mb-8">
                            <h2 className="text-4xl sm:text-5xl font-bold text-slate-900 tracking-tight mb-3">
                                One India, One Library
                            </h2>
                            <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
                                Find trusted books, papers, videos, and archives from the national learning network.
                            </p>
                        </div>

                        <div className="mb-5">
                            <p className="text-xs font-semibold text-slate-500 mb-3 text-center uppercase tracking-[0.16em]">
                                Choose domain
                            </p>
                            <div className="flex flex-wrap justify-center gap-2 stagger-children" role="group" aria-label="Choose domain">
                                {DOMAINS.map(d => (
                                    <button
                                        key={d.key}
                                        onClick={() => {
                                            setSelectedDomain(d.key);
                                            setTimeout(() => inputRef.current?.focus(), 100);
                                        }}
                                        type="button"
                                        aria-label={`Select ${d.label}`}
                                        aria-pressed={selectedDomain === d.key}
                                        className={`domain-pill px-4 py-2.5 rounded-xl border text-sm font-semibold cursor-pointer select-none ${selectedDomain === d.key
                                            ? 'domain-pill-active'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                            } touch-target`}
                                    >
                                        <span className="mr-1.5">{d.emoji}</span>
                                        {d.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </section>
                )}

                {/* Compact domain strip */}
                {(searchPerformed || trimmedQuery) && (
                    <div className="pt-4 pb-2 animate-fade-in" aria-label="Domain strip">
                        <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Switch domain">
                            {DOMAINS.map(d => (
                                <button
                                    key={d.key}
                                    onClick={() => setSelectedDomain(d.key)}
                                    type="button"
                                    aria-label={`Switch to ${d.label}`}
                                    aria-pressed={selectedDomain === d.key}
                                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all select-none ${selectedDomain === d.key
                                        ? 'domain-pill-active'
                                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                        } touch-target`}
                                >
                                    <span className="mr-1">{d.emoji}</span>
                                    {d.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Search */}
                <div className={`${showInitialHero ? '' : 'sticky top-[65px] z-40 pt-2 pb-4 sm:pb-5 bg-[linear-gradient(to_bottom,rgba(234,242,255,0.98)_0%,rgba(248,250,252,0.97)_68%,rgba(248,250,252,0)_100%)] backdrop-blur-[2px]'}`}>
                    <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
                            <SearchIcon className="w-5 h-5" />
                        </div>
                        <input
                            ref={inputRef}
                            id={SEARCH_INPUT_ID}
                            type="text"
                            placeholder={selectedDomain ? 'Search topics, authors, or content...' : 'Select a domain above to begin searching'}
                            value={q}
                            onChange={e => setQ(e.target.value)}
                            disabled={!selectedDomain}
                            aria-invalid={Boolean(error)}
                            aria-describedby={searchDescriptionIds}
                            enterKeyHint="search"
                            className={`search-input-glow w-full pl-12 pr-12 py-4 text-base bg-white border border-slate-200 rounded-2xl shadow-sm outline-none placeholder:text-slate-400 font-medium text-slate-800 transition-all ${!selectedDomain ? 'bg-slate-100 cursor-not-allowed opacity-70' : 'hover:border-slate-300'} `}
                        />
                        {q && (
                            <button
                                onClick={() => setQ('')}
                                aria-label="Clear search input"
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer p-1 rounded-full hover:bg-slate-100"
                                type="button"
                            >
                                <XIcon />
                            </button>
                        )}
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-2 px-1">
                        <p id={SEARCH_STATUS_ID} role="status" aria-live="polite" aria-atomic="true" className="text-xs font-medium text-slate-500">{statusMessage}</p>
                        {canRetry && (error || searchPerformed) && (
                            <button
                                onClick={retrySearch}
                                type="button"
                                aria-label={error ? 'Retry search' : 'Refresh search results'}
                                className="text-xs font-semibold text-[#0b57d0] hover:text-[#0946aa] transition-colors touch-target cursor-pointer"
                            >
                                {error ? 'Retry Search' : 'Refresh'}
                            </button>
                        )}
                    </div>

                    {apiRequestState?.status === 'success' && !loading && (
                        <div className="mt-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 animate-fade-in" role="status" aria-live="polite" aria-atomic="true">
                            <p className="text-xs font-semibold text-emerald-800">Backend API fetch successful</p>
                            <p className="text-xs text-emerald-700 leading-relaxed">
                                Retrieved {apiRequestState.count} result{apiRequestState.count === 1 ? '' : 's'} from <span className="font-semibold break-all">{apiEndpointLabel}</span>{apiSuccessTimeLabel ? ` at ${apiSuccessTimeLabel}.` : '.'}
                            </p>
                        </div>
                    )}
                </div>

                {/* Loading state */}
                {loading && (
                    <div className="mt-6" role="status" aria-live="polite" aria-label="Loading search results">
                        <span className="sr-only">Loading search results</span>
                        <AISkeleton />
                        <div className="flex items-center gap-2 mb-4">
                            <div className="skeleton w-32 h-5" />
                        </div>
                        <ResultSkeleton />
                    </div>
                )}

                {/* Error */}
                {error && !loading && (
                    <div className="mt-5 mb-6 animate-fade-in-up" role="alert" aria-live="assertive">
                        <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50/85 p-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center shrink-0 mt-0.5">
                                    <span className="text-rose-500 text-sm font-bold">!</span>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-rose-800">Search failed</p>
                                    <p id={SEARCH_ERROR_ID} className="text-sm text-rose-700 mt-0.5">{error}</p>
                                    {apiErrorHint && (
                                        <p className="text-xs text-rose-700 mt-1.5">{apiErrorHint}</p>
                                    )}
                                </div>
                            </div>
                            {canRetry && (
                                <button
                                    onClick={retrySearch}
                                    type="button"
                                    aria-label="Retry search"
                                    className="self-start rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors touch-target"
                                >
                                    Retry Search
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* AI overview */}
                {aiCard && !loading && (
                    <section className="ai-card-border mt-6 mb-8 animate-fade-in-up" aria-labelledby="ai-overview-heading">
                        <div className="p-6">
                            <div className="flex flex-wrap items-center gap-2.5 mb-4">
                                <div className="w-8 h-8 rounded-xl bg-[#0b57d0] text-white flex items-center justify-center shadow-sm shadow-blue-500/25">
                                    <SparklesIcon className="w-4 h-4" />
                                </div>
                                <h2 id="ai-overview-heading" className="text-base font-bold text-slate-900">AI Overview</h2>
                                <div className="ml-auto flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] font-bold text-[#0b57d0] bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase tracking-wider">
                                        Preview
                                    </span>
                                    {(() => {
                                        const badge = summarizerBadgeConfig(aiCard?.summarizerStatus);
                                        return (
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${badge.className}`}>
                                                {badge.label}
                                            </span>
                                        );
                                    })()}
                                    <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                                        <input
                                            type="checkbox"
                                            checked={alwaysShowNarrative}
                                            onChange={(event) => setAlwaysShowNarrative(event.target.checked)}
                                            className="h-4 w-4 rounded border-slate-300 text-[#0b57d0] focus:ring-[#0b57d0]"
                                        />
                                        Always show paragraph
                                    </label>
                                </div>
                            </div>

                            {(() => {
                                const hasSentenceDetails = Array.isArray(aiCard?.sentenceDetails) && aiCard.sentenceDetails.length;
                                const hasSentences = Array.isArray(aiCard?.sentences) && aiCard.sentences.length;

                                const evidenceText = hasSentenceDetails
                                    ? aiCard.sentenceDetails.map((item) => item.text).join(' ')
                                    : (hasSentences ? aiCard.sentences.join(' ') : '');

                                const normalizedSnippet = normalizeAiSummaryText(aiCard?.snippet);
                                const normalizedEvidence = normalizeAiSummaryText(evidenceText);
                                const showNarrative = Boolean(normalizedSnippet && normalizedEvidence && normalizedSnippet !== normalizedEvidence);
                                const shouldShowNarrative = alwaysShowNarrative
                                    ? Boolean(normalizedSnippet)
                                    : showNarrative;

                                return (
                                    <>
                                        {(shouldShowNarrative || (!hasSentenceDetails && !hasSentences)) && (
                                            <p className="text-[15px] text-slate-700 leading-relaxed">
                                                {aiCard.snippet}
                                            </p>
                                        )}

                                        {hasSentenceDetails ? (
                                            <div className={shouldShowNarrative ? 'mt-4 pt-4 border-t border-slate-100' : ''}>
                                                <ul className="space-y-2.5">
                                                    {aiCard.sentenceDetails.map((sentence, idx) => (
                                                        <li key={`ai-sentence-${idx}`} className="text-[15px] text-slate-700 leading-relaxed flex items-start gap-2">
                                                            <span className="text-[#0b57d0] mt-0.5">•</span>
                                                            <span className="flex-1">
                                                                <span>{sentence.text}</span>
                                                                {sentence.citation && (
                                                                    <span className="ml-1 text-[11px] font-bold text-[#0b57d0] align-middle">
                                                                        {sentence.citation}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            {typeof sentence.confidence === 'number' && (
                                                                <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                                                                    {Math.round(sentence.confidence * 100)}%
                                                                </span>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ) : hasSentences ? (
                                            <div className={shouldShowNarrative ? 'mt-4 pt-4 border-t border-slate-100' : ''}>
                                                <ul className="space-y-2.5">
                                                    {aiCard.sentences.map((sentence, idx) => (
                                                        <li key={`ai-sentence-fallback-${idx}`} className="text-[15px] text-slate-700 leading-relaxed flex items-start gap-2">
                                                            <span className="text-[#0b57d0] mt-0.5">•</span>
                                                            <span>{sentence}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ) : null}
                                    </>
                                );
                            })()}

                            <div className="mt-5 pt-4 border-t border-slate-100">
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Sources</p>
                                <div className="space-y-2 stagger-children">
                                    {aiCard.sources.map((s, i) => (
                                        <a
                                            key={`ai-source-${i}`}
                                            href={s.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            aria-label={`Open source ${s.ref || (i + 1)}: ${s.title}`}
                                            className="flex items-center gap-3 group px-3 py-2 -mx-3 rounded-lg hover:bg-slate-100/80 transition-colors touch-target"
                                        >
                                            <span className="w-5 h-5 rounded-md bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold shrink-0">
                                                {s.ref || (i + 1)}
                                            </span>
                                            <span className="text-sm font-medium text-[#0b57d0] group-hover:text-[#0946aa] truncate">
                                                {s.title}
                                            </span>
                                            <span className="text-xs text-slate-400">- {s.author}</span>
                                            <ExternalLinkIcon className="w-3 h-3 text-slate-300 group-hover:text-slate-500 ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                {/* Search results */}
                {searchPerformed && !loading && (
                    <section className="animate-fade-in-up" aria-labelledby={SEARCH_RESULTS_HEADING_ID}>
                        {hasResults ? (
                            <>
                                <div className="mb-4 rounded-xl border border-slate-200 bg-white/90 p-3.5 sm:p-4">
                                    <div className="flex items-center gap-2">
                                        <h2 id={SEARCH_RESULTS_HEADING_ID} className="text-base sm:text-lg font-bold text-slate-900">Search Results</h2>
                                        <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                                            {filteredResults.length}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                        Showing {filteredResults.length} of {results.length} resources{trimmedQuery ? ` for "${trimmedQuery}"` : ''}.
                                    </p>

                                    {resultTypeOptions.length > 1 && (
                                        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter results by type">
                                            {resultTypeOptions.map((option) => (
                                                <button
                                                    key={`result-filter-${option.key}`}
                                                    type="button"
                                                    onClick={() => setActiveResultType(option.key)}
                                                    aria-label={`Filter by ${option.label}`}
                                                    aria-pressed={activeResultType === option.key}
                                                    className={`result-filter-chip ${activeResultType === option.key ? 'result-filter-chip-active' : ''} touch-target`}
                                                >
                                                    <span>{option.label}</span>
                                                    <span className="result-filter-chip-count">{option.count}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {hasFilteredResults ? (
                                    <div className="space-y-2.5 pb-12 stagger-children" role="list" aria-label="Search results list">
                                        {filteredResults.map((r, index) => {
                                            const normalizedType = normalizeResultType(r.type);
                                            const typeText = resultTypeLabel(normalizedType);

                                            return (
                                                <article
                                                    key={r.id || `result-${index}`}
                                                    role="listitem"
                                                    className="result-card bg-white rounded-xl p-4 sm:p-5 group"
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <a
                                                            href={r.url || '#'}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            aria-label={`Open result: ${r.title}`}
                                                            className="text-[15px] sm:text-base font-semibold text-[#0b57d0] hover:text-[#0946aa] transition-colors inline-flex items-center gap-1.5 group/link"
                                                        >
                                                            <span className="line-clamp-2">{r.title}</span>
                                                            <ExternalLinkIcon className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                                                        </a>

                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-xs text-slate-500">
                                                            {r.author && (
                                                                <span className="flex items-center gap-1 font-medium">
                                                                    <UserIcon className="w-3.5 h-3.5" />
                                                                    <span className="truncate max-w-[210px]">{r.author}</span>
                                                                </span>
                                                            )}
                                                            {r.year && (
                                                                <span className="font-medium">{r.year}</span>
                                                            )}
                                                            {normalizedType && (
                                                                <span className="px-2 py-0.5 bg-slate-100 rounded-md font-semibold text-slate-600">
                                                                    {typeText}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {(r.desc || r.text || r.content) && (
                                                            <p className="mt-2 text-sm text-slate-600 leading-relaxed line-clamp-2">
                                                                {r.desc || r.text || r.content}
                                                            </p>
                                                        )}
                                                    </div>
                                                </article>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center py-12 animate-fade-in rounded-xl border border-slate-200 bg-white/85">
                                        <h3 className="text-base font-bold text-slate-700 mb-1">No items in this type</h3>
                                        <p className="text-sm text-slate-500 mb-3">Try another type filter or reset to all results.</p>
                                        <button
                                            onClick={() => setActiveResultType('all')}
                                            type="button"
                                            aria-label="Reset filter to all results"
                                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors touch-target"
                                        >
                                            Show All Results
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="text-center py-16 animate-fade-in">
                                <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                                    <SearchIcon className="w-7 h-7 text-slate-400" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-700 mb-1.5">No results found</h3>
                                <p className="text-sm text-slate-500">
                                    Try broader keywords or switch to another domain.
                                </p>
                            </div>
                        )}
                    </section>
                )}

                {/* Empty prompt */}
                {!trimmedQuery && !loading && !searchPerformed && selectedDomain && (
                    <div className="text-center py-14 animate-fade-in">
                        <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
                            <SearchIcon className="w-7 h-7 text-[#0b57d0]" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-700 mb-1.5">Start searching</h3>
                        <p className="text-sm text-slate-500">
                            Type a keyword above to explore <span className="font-semibold text-[#0b57d0]">{activeDomainLabel}</span> resources.
                        </p>
                    </div>
                )}
            </main>

            <footer className="mt-8 border-t border-slate-200/70 py-6">
                <p className="text-center text-xs text-slate-500">
                    Powered by <span className="font-semibold text-slate-600">National Digital Library of India</span> · IIT Kharagpur
                </p>
            </footer>
        </div>
    );
}

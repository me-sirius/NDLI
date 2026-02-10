import React, { useState, useEffect, useRef } from 'react';
import { ndliSearch } from '../services/ndliSearch';

// ─── Icons (inline SVGs to avoid dependencies) ───────────────────────────────
const SearchIcon = ({ className = "w-5 h-5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
);

const SparklesIcon = ({ className = "w-5 h-5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
);

const BookIcon = ({ className = "w-5 h-5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
);

const UserIcon = ({ className = "w-4 h-4" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
);

const ExternalLinkIcon = ({ className = "w-3.5 h-3.5" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
);

const XIcon = ({ className = "w-4 h-4" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
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
    const inputRef = useRef(null);

    // Debounced NDLI search
    useEffect(() => {
        const query = q.trim();
        if (!query || !selectedDomain) {
            setResults([]);
            setAiCard(null);
            setError(null);
            setSearchPerformed(false);
            return;
        }

        const timeoutId = setTimeout(async () => {
            setLoading(true);
            setError(null);
            setSearchPerformed(true);

            try {
                console.log('🔍 Searching NDLI for:', query, 'in domain:', selectedDomain);
                const data = await ndliSearch(query, selectedDomain);
                console.log('📦 NDLI API Response:', data);

                const rows = data.rows || [];
                setResults(rows);

                if (rows.length) {
                    const snippet = rows.map(r => r.desc || r.title).slice(0, 3).join(' ');
                    setAiCard({
                        snippet: snippet.slice(0, 500) + (snippet.length > 500 ? '...' : ''),
                        sources: rows.slice(0, 3).map((r) => ({
                            title: r.title,
                            url: r.url || '#',
                            author: r.author || 'NDLI',
                        })),
                    });
                } else {
                    setAiCard(null);
                }
            } catch (err) {
                console.error('❌ NDLI search failed:', err);
                setError(err.message || 'Search failed. Please try again.');
                setResults([]);
                setAiCard(null);
            } finally {
                setLoading(false);
            }
        }, 600);

        return () => clearTimeout(timeoutId);
    }, [q, selectedDomain]);

    const activeDomainLabel = DOMAINS.find(d => d.key === selectedDomain)?.label;

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
            {/* ─── Top Nav Bar ─────────────────────────────────── */}
            <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-200/60">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
                            <BookIcon className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-gray-900 leading-tight tracking-tight">NDLI Search</h1>
                            <p className="text-[11px] text-gray-400 font-medium -mt-0.5">National Digital Library of India</p>
                        </div>
                    </div>
                    {activeDomainLabel && (
                        <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100 animate-fade-in">
                            {activeDomainLabel}
                        </span>
                    )}
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 sm:px-6">
                {/* ─── Hero / Domain Selector ───────────────────── */}
                {!searchPerformed && !q && (
                    <div className="pt-16 pb-8 animate-fade-in-up">
                        <div className="text-center mb-10">
                            <h2 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight mb-3">
                                One India, One Library
                            </h2>
                            <p className="text-lg text-gray-500 max-w-lg mx-auto">
                                Search through millions of educational resources from India's largest digital library.
                            </p>
                        </div>

                        {/* Domain selector */}
                        <div className="mb-8">
                            <p className="text-sm font-semibold text-gray-500 mb-3 text-center uppercase tracking-wider">
                                Choose your domain
                            </p>
                            <div className="flex flex-wrap justify-center gap-2 stagger-children">
                                {DOMAINS.map(d => (
                                    <button
                                        key={d.key}
                                        onClick={() => {
                                            setSelectedDomain(d.key);
                                            setTimeout(() => inputRef.current?.focus(), 100);
                                        }}
                                        type="button"
                                        className={`domain-pill px-4 py-2.5 rounded-xl border text-sm font-semibold cursor-pointer select-none ${selectedDomain === d.key
                                            ? 'domain-pill-active'
                                            : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300'
                                            }`}
                                    >
                                        <span className="mr-1.5">{d.emoji}</span>
                                        {d.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── Compact Domain Strip (when searching) ───── */}
                {(searchPerformed || q) && (
                    <div className="pt-4 pb-2 animate-fade-in">
                        <div className="flex flex-wrap gap-1.5 mb-4">
                            {DOMAINS.map(d => (
                                <button
                                    key={d.key}
                                    onClick={() => setSelectedDomain(d.key)}
                                    type="button"
                                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all select-none ${selectedDomain === d.key
                                        ? 'bg-indigo-600 text-white border-transparent shadow-sm shadow-indigo-500/20'
                                        : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-gray-700'
                                        }`}
                                >
                                    <span className="mr-1">{d.emoji}</span>
                                    {d.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ─── Search Bar ──────────────────────────────── */}
                <div className={`${!searchPerformed && !q ? '' : 'sticky top-[57px] z-40 bg-gradient-to-b from-white via-white to-white/0 pb-4 pt-1'}`}>
                    <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                            <SearchIcon className="w-5 h-5" />
                        </div>
                        <input
                            ref={inputRef}
                            type="text"
                            placeholder={selectedDomain ? 'Search topics, authors, or content...' : 'Select a domain above to begin searching'}
                            value={q}
                            onChange={e => setQ(e.target.value)}
                            disabled={!selectedDomain}
                            className={`search-input-glow w-full pl-12 pr-12 py-4 text-base bg-white border border-gray-200 rounded-2xl shadow-sm outline-none placeholder:text-gray-400 font-medium text-gray-800 transition-all ${!selectedDomain ? 'bg-gray-50 cursor-not-allowed opacity-60' : 'hover:border-gray-300'
                                }`}
                        />
                        {q && (
                            <button
                                onClick={() => setQ('')}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer p-1 rounded-full hover:bg-gray-100"
                                type="button"
                            >
                                <XIcon />
                            </button>
                        )}
                    </div>
                </div>

                {/* ─── Loading State ───────────────────────────── */}
                {loading && (
                    <div className="mt-6">
                        <AISkeleton />
                        <div className="flex items-center gap-2 mb-4">
                            <div className="skeleton w-32 h-5" />
                        </div>
                        <ResultSkeleton />
                    </div>
                )}

                {/* ─── Error ───────────────────────────────────── */}
                {error && !loading && (
                    <div className="mt-6 mb-6 animate-fade-in-up">
                        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
                            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                                <span className="text-red-500 text-sm font-bold">!</span>
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-red-800">Search failed</p>
                                <p className="text-sm text-red-600 mt-0.5">{error}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── AI Overview Card ─────────────────────────── */}
                {aiCard && !loading && (
                    <div className="ai-card-border mt-6 mb-8 animate-fade-in-up">
                        <div className="p-6">
                            {/* Header */}
                            <div className="flex items-center gap-2.5 mb-4">
                                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-cyan-500 flex items-center justify-center shadow-sm">
                                    <SparklesIcon className="w-4.5 h-4.5 text-white" />
                                </div>
                                <h2 className="text-base font-bold text-gray-900">AI-Generated Summary</h2>
                                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100 uppercase tracking-wider">
                                    Beta
                                </span>
                            </div>

                            {/* Summary Text */}
                            <p className="text-[15px] text-gray-700 leading-relaxed">
                                {aiCard.snippet}
                            </p>

                            {/* Sources */}
                            <div className="mt-5 pt-4 border-t border-gray-100">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Sources</p>
                                <div className="space-y-2 stagger-children">
                                    {aiCard.sources.map((s, i) => (
                                        <a
                                            key={`ai-source-${i}`}
                                            href={s.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex items-center gap-3 group px-3 py-2 -mx-3 rounded-lg hover:bg-indigo-50/50 transition-colors"
                                        >
                                            <span className="w-5 h-5 rounded-md bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">
                                                {i + 1}
                                            </span>
                                            <span className="text-sm font-medium text-indigo-600 group-hover:text-indigo-700 truncate">
                                                {s.title}
                                            </span>
                                            <span className="text-xs text-gray-400">— {s.author}</span>
                                            <ExternalLinkIcon className="w-3 h-3 text-gray-300 group-hover:text-indigo-400 ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── Search Results ──────────────────────────── */}
                {searchPerformed && !loading && (
                    <div className="animate-fade-in-up">
                        {results.length > 0 ? (
                            <>
                                <div className="flex items-center gap-2 mb-4">
                                    <h2 className="text-lg font-bold text-gray-900">Search Results</h2>
                                    <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                                        {results.length}
                                    </span>
                                </div>
                                <div className="space-y-3 pb-12 stagger-children">
                                    {results.map((r, index) => (
                                        <article
                                            key={r.id || `result-${index}`}
                                            className="result-card bg-white rounded-xl p-5 group"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <a
                                                        href={r.url || '#'}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-base font-semibold text-indigo-600 hover:text-indigo-800 transition-colors inline-flex items-center gap-1.5 group/link"
                                                    >
                                                        <span className="line-clamp-2">{r.title}</span>
                                                        <ExternalLinkIcon className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                                                    </a>

                                                    {/* Meta row */}
                                                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                                                        {r.author && (
                                                            <span className="flex items-center gap-1 font-medium">
                                                                <UserIcon className="w-3.5 h-3.5" />
                                                                <span className="truncate max-w-[200px]">{r.author}</span>
                                                            </span>
                                                        )}
                                                        {r.year && (
                                                            <span className="font-medium">{r.year}</span>
                                                        )}
                                                        {r.type && (
                                                            <span className="px-2 py-0.5 bg-gray-100 rounded-md font-semibold text-gray-500 capitalize">
                                                                {r.type}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Description */}
                                                    {(r.desc || r.text || r.content) && (
                                                        <p className="mt-2.5 text-sm text-gray-600 leading-relaxed line-clamp-2">
                                                            {r.desc || r.text || r.content}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="text-center py-16 animate-fade-in">
                                <div className="w-16 h-16 mx-auto rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                                    <SearchIcon className="w-7 h-7 text-gray-400" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-700 mb-1.5">No results found</h3>
                                <p className="text-sm text-gray-500">
                                    Try different keywords or switch the domain for better results.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* ─── Empty State (no search yet) ─────────────── */}
                {!q && !loading && !searchPerformed && selectedDomain && (
                    <div className="text-center py-16 animate-fade-in">
                        <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
                            <SearchIcon className="w-7 h-7 text-indigo-400" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-700 mb-1.5">Start searching</h3>
                        <p className="text-sm text-gray-500">
                            Type a keyword above to explore <span className="font-medium text-indigo-600">{activeDomainLabel}</span> resources
                        </p>
                    </div>
                )}
            </main>

            {/* ─── Footer ──────────────────────────────────── */}
            <footer className="mt-16 border-t border-gray-200/60 py-6">
                <p className="text-center text-xs text-gray-400">
                    Powered by <span className="font-semibold text-gray-500">National Digital Library of India</span> · IIT Kharagpur
                </p>
            </footer>
        </div>
    );
}

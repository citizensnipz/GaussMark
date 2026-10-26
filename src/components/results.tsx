"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, HardDrive, Globe2, RefreshCw } from "lucide-react";
import { readSessions } from "@/core/storage";
import { getCommunity, type CommunityRecord } from "@/core/community";
import type { BenchmarkResult } from "@/core/types";
import { Header, Footer, Empty } from "./ui";
import { ResultsTable } from "./dashboard";
import { Report } from "./report";
import { Comparison } from "./comparison";
export function ResultsExplorer() {
  const [source, setSource] = useState<"local" | "community">("local"),
    [rows, setRows] = useState<(BenchmarkResult | CommunityRecord)[]>([]),
    [selected, setSelected] = useState<
      BenchmarkResult | CommunityRecord | null
    >(null),
    [error, setError] = useState(""),
    [custom, setCustom] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    if (source === "local")
      setRows(
        readSessions().filter((r) =>
          custom ? r.scene.source === "local" : r.scene.source === "reference",
        ),
      );
    else {
      setRows([]);
      getCommunity(
        new URLSearchParams({ source: custom ? "local" : "reference" }),
      )
        .then((data) => {
          if (active) setRows(data.results);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [source, custom, refresh]);
  return (
    <div className="application">
      <Header active="Results" />
      <main className="results-page">
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow">SESSION ARCHIVE</span>
            <h1>Every frame tells a story.</h1>
            <p>
              Inspect measurements, compare repeat passes, and export the
              underlying data.
            </p>
          </div>
          <Link href="/benchmark/" className="button">
            New session
            <ArrowUpRight size={15} />
          </Link>
        </div>
        <Comparison />
        <div className="results-controls">
          <div className="segmented">
            <button
              className={source === "local" ? "active" : ""}
              onClick={() => setSource("local")}
            >
              <HardDrive size={15} />
              This device
            </button>
            <button
              className={source === "community" ? "active" : ""}
              onClick={() => setSource("community")}
            >
              <Globe2 size={15} />
              Community
            </button>
          </div>
          <select
            aria-label="Result scene class"
            value={custom ? "custom" : "reference"}
            onChange={(e) => setCustom(e.target.value === "custom")}
          >
            <option value="reference">Reference scenes</option>
            <option value="custom">Custom scenes · separate workloads</option>
          </select>
          <button
            className="icon-button"
            aria-label="Refresh results"
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={16} />
          </button>
          <span className="muted">
            {rows.length} sessions · frame-interval-v1
          </span>
        </div>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        <section className="panel results-table-panel">
          {rows.length ? (
            <ResultsTable
              rows={rows as CommunityRecord[]}
              onSelect={(r) =>
                setSelected(rows.find((row) => row.id === r.id) ?? r)
              }
            />
          ) : (
            <Empty
              title={
                source === "local"
                  ? "Your next run belongs here."
                  : "No community results in this view."
              }
              description={
                source === "local"
                  ? "Your last 20 completed sessions are saved in this browser, with raw frame samples."
                  : "Results appear only after someone explicitly submits a completed run."
              }
              action
            />
          )}
        </section>
        <div className="archive-note">
          <span>
            <HardDrive size={15} />
            Local sessions stay in this browser until you export or submit them.
          </span>
          <span>Custom and reference scenes are always kept separate.</span>
        </div>
      </main>
      <Footer />
      {selected && (
        <Report result={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

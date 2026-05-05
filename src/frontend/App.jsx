import { useRef } from "react";
import { VisColsCtx } from "./components/ui.jsx";
import useAppState from "./hooks/useAppState.jsx";
import CategoriesTab from "./tabs/CategoriesTab.jsx";
import IncomeTab from "./tabs/IncomeTab.jsx";
import TaxRatesTab from "./tabs/TaxRatesTab.jsx";
import BudgetTab, { BudgetToolbar } from "./tabs/BudgetTab.jsx";
import ChartsTab from "./tabs/ChartsTab.jsx";
import MilestoneViewTab from "./tabs/MilestoneViewTab.jsx";
import MilestonesSubtab from "./tabs/MilestonesSubtab.jsx";
import ForecastTab from "./tabs/ForecastTab.jsx";
import TransactionsTab from "./tabs/TransactionsTab.jsx";
import SettingsTab from "./tabs/SettingsTab.jsx";




/* ══════════════════════════ MAIN APP ══════════════════════════ */
export default function App() {
  const S = useAppState();
  const iconRef = useRef(null);
  const headerRef = useRef(null);

  return (
    <VisColsCtx.Provider value={S.visCols}>
    <div style={{ minHeight: "100vh", background: S.bg, fontFamily: "'DM Sans',sans-serif", color: S.tx }}>
      <style>{`
        html, body { max-width: 100vw; margin: 0; padding: 0; overflow-x: hidden; }
        * { box-sizing: border-box; }
        input, textarea, select { max-width: 100%; min-width: 0; }
        :root { --card-bg:#fff; --card-color:#222; --input-bg:#fafafa; --input-color:#222; --input-border:#e0e0e0; --tx:#333; --tx2:#555; --tx3:#999; --bdr:#e0e0e0; --bdr2:#e0ddd8; --shadow:0 1px 4px rgba(0,0,0,.06),0 6px 20px rgba(0,0,0,.03); }
        input, textarea { background: var(--input-bg) !important; color: var(--input-color) !important; border-color: var(--input-border) !important; }
        select { color: var(--input-color) !important; border-color: var(--input-border) !important; }
        select:not(.cat-dd) { background: var(--input-bg) !important; }
        .cat-dd { background: transparent; border: none; font-size: 13px; padding: 1px 4px; color: var(--tx2, #555); cursor: pointer; max-width: 120px; outline: none; }
        .cat-dd:hover, .cat-dd:focus { background: var(--input-bg, #f5f5f5) !important; border-radius: 4px; }
        input::placeholder { color: var(--tx3); }
        .recharts-default-tooltip { background: var(--card-bg) !important; color: var(--card-color) !important; border: none !important; }
        .recharts-legend-item-text { color: var(--card-color) !important; }
      `}</style>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Fraunces:wght@400;700;800;900&display=swap" rel="stylesheet" />
      {/* Header + Tabs - single sticky block */}
      <div ref={headerRef} style={{ position: "sticky", top: 0, zIndex: 50, background: S.headerBg, color: "#fff" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: S.mob ? "6px 12px 0" : "10px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: S.mob ? 8 : 12, marginBottom: 4 }}>
            <label style={{ cursor: "pointer", flexShrink: 0 }} title="Click to upload custom icon">
              {S.customIcon
                ? <img src={S.customIcon} style={{ width: S.mob ? 28 : 34, height: S.mob ? 28 : 34, borderRadius: 8, objectFit: "cover" }} />
                : <div style={{ width: S.mob ? 28 : 34, height: S.mob ? 28 : 34, borderRadius: 8, background: "linear-gradient(135deg,#E8573A,#F2A93B)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: S.mob ? 14 : 18 }}>💰</div>}
              <input ref={iconRef} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = ev => S.setCustomIcon(ev.target.result); r.readAsDataURL(f); } }} style={{ display: "none" }} />
            </label>
            <div style={{ flex: 1, minWidth: 0 }}>
              {S.editingTitle
                ? <input autoFocus value={S.titleDraft} onChange={e => S.setTitleDraft(e.target.value)}
                    onBlur={() => { S.setAppTitle(S.titleDraft.trim() || S.appTitle); S.setEditingTitle(false); }}
                    onKeyDown={e => { if (e.key === "Enter") { S.setAppTitle(S.titleDraft.trim() || S.appTitle); S.setEditingTitle(false); } if (e.key === "Escape") S.setEditingTitle(false); }}
                    style={{ margin: 0, fontSize: S.mob ? 16 : 22, fontFamily: "'Fraunces',serif", fontWeight: 800, background: "transparent", border: "none", borderBottom: "2px solid #E8573A", color: "#fff", outline: "none", width: "100%" }} />
                : <h1 onClick={() => { S.setTitleDraft(S.appTitle); S.setEditingTitle(true); }} style={{ margin: 0, fontSize: S.mob ? 16 : 22, fontFamily: "'Fraunces',serif", fontWeight: 800, cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title="Click to rename">{S.appTitle}</h1>}
              {!S.mob && <p style={{ margin: 0, fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase" }}>{S.tax.year} Tax Year • {(S.tax.p1State || {}).name || "State"}</p>}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => S.setDarkMode("light")} style={{ padding: "5px 10px", background: !S.dk && !S.waf ? "#E8573A" : "rgba(255,255,255,0.1)", color: !S.dk && !S.waf ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>☀️</button>
              <button onClick={() => S.setDarkMode("dark")} style={{ padding: "5px 10px", background: S.dk ? "#F2A93B" : "rgba(255,255,255,0.1)", color: S.dk ? "#1a1a1a" : "#888", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🌙</button>
              <button onClick={() => S.setDarkMode("waf")} style={{ padding: "5px 10px", background: S.waf ? "#c96b70" : "rgba(255,255,255,0.1)", color: S.waf ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🌸</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 2, borderBottom: "1px solid #444", overflowX: "auto" }}>
            <button style={S.ts(S.tab === "taxes")} onClick={() => S.setTab("taxes")}>Tax Rates</button>
            <button style={S.ts(S.tab === "settings")} onClick={() => S.setTab("settings")}>Income</button>
            <button style={S.ts(S.tab === "budget")} onClick={() => S.setTab("budget")}>Budget</button>
            <button style={S.ts(S.tab === "transactions")} onClick={() => S.setTab("transactions")}>Transactions</button>
            <button style={S.ts(S.tab === "charts")} onClick={() => S.setTab("charts")}>Charts</button>
            <button style={S.ts(S.tab === "cats")} onClick={() => S.setTab("cats")}>Categories</button>
            <button style={S.ts(S.tab === "prefs")} onClick={() => S.setTab("prefs")}>Settings</button>
          </div>
          {/* Subtab pill row — only shown for tabs that have subtabs (Budget, Charts). */}
          {(S.tab === "budget" || S.tab === "charts") && (
            <div style={{ display: "flex", gap: 6, padding: "6px 0 4px", overflowX: "auto" }}>
              {S.tab === "budget" && [["live", "Live"], ["milestones", "Milestones"]].map(([k, l]) => {
                const active = S.budgetSubtab === k;
                return (
                  <button key={k} onClick={() => S.setBudgetSubtab(k)} style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, border: active ? `2px solid ${S.tabAccent}` : "2px solid rgba(255,255,255,0.15)", borderRadius: 999, background: active ? "rgba(255,255,255,0.15)" : "transparent", color: active ? "#fff" : "#aaa", cursor: "pointer", whiteSpace: "nowrap" }}>{l}</button>
                );
              })}
              {S.tab === "charts" && [["trends", "Trends"], ["forecast", "Forecast"]].map(([k, l]) => {
                const active = S.chartsSubtab === k;
                return (
                  <button key={k} onClick={() => S.setChartsSubtab(k)} style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, border: active ? `2px solid ${S.tabAccent}` : "2px solid rgba(255,255,255,0.15)", borderRadius: 999, background: active ? "rgba(255,255,255,0.15)" : "transparent", color: active ? "#fff" : "#aaa", cursor: "pointer", whiteSpace: "nowrap" }}>{l}</button>
                );
              })}
            </div>
          )}
        </div>
        {/* Banner + Toolbar - inside sticky header, only on budget tab */}
        {S.tab === "budget" && S.budgetSubtab === "live" && <BudgetToolbar mob={S.mob} dk={S.dk} waf={S.waf} C={S.C} moC={S.moC} y4={S.y4} y5={S.y5} tSavW={S.tSavW} remY52={S.remY52} bannerOpen={S.bannerOpen} setBannerOpen={S.setBannerOpen} toolbarOpen={S.toolbarOpen} setToolbarOpen={S.setToolbarOpen} visCols={S.visCols} setVisCols={S.setVisCols} sortBy={S.sortBy} setSortBy={S.setSortBy} sortDir={S.sortDir} setSortDir={S.setSortDir} hlThresh={S.hlThresh} setHlThresh={S.setHlThresh} hlPeriod={S.hlPeriod} setHlPeriod={S.setHlPeriod} showPerPerson={S.showPerPerson} setShowPerPerson={S.setShowPerPerson} isMixed={S.isMixed} allExpanded={S.allExpanded} expandAll={S.expandAll} collapseAll={S.collapseAll} toggleAll={S.toggleAll} setShowAddItem={S.setShowAddItem} setShowBulkAdd={S.setShowBulkAdd} cats={S.cats} setBulkTargets={S.setBulkTargets} setBulkName={S.setBulkName} setBulkVal={S.setBulkVal} setBulkCat={S.setBulkCat} milestones={S.milestones} setMilestones={S.setMilestones} msDate={S.msDate} setMsDate={S.setMsDate} msLabel={S.msLabel} setMsLabel={S.setMsLabel} ewk={S.ewk} savSorted={S.savSorted} st={S.st} C_full={S.C} tNW={S.tNW} tDW={S.tDW} tExpW={S.tExpW} tSavW_full={S.tSavW} remW={S.remW} totalSavPlusRemW={S.totalSavPlusRemW} cSal={S.cSal} kSal={S.kSal} cEaip={S.cEaip} kEaip={S.kEaip} fil={S.fil} preDed={S.preDed} postDed={S.postDed} c4pre={S.c4pre} c4ro={S.c4ro} k4pre={S.k4pre} k4ro={S.k4ro} exp={S.exp} sav={S.sav} savCats={S.savCats} transferCats={S.transferCats} incomeCats={S.incomeCats} tax={S.tax} />}
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: S.mob ? "12px 10px 60px" : "24px 20px 60px" }}>

        {/* ═══ TAX RATES ═══ */}
        {S.tab === "taxes" && <TaxRatesTab mob={S.mob} tax={S.tax} upTax={S.upTax} upP1State={S.upP1State} upP2State={S.upP2State} setTax={S.setTax} p1Name={S.p1Name} p2Name={S.p2Name} fil={S.fil} C={S.C} allTaxDB={S.allTaxDB} loadTaxYear={S.loadTaxYear} showTaxPaste={S.showTaxPaste} setShowTaxPaste={S.setShowTaxPaste} taxPaste={S.taxPaste} setTaxPaste={S.setTaxPaste} addTaxYear={S.addTaxYear} fetchStatus={S.fetchStatus} setFetchStatus={S.setFetchStatus} />}

        {/* ═══ INCOME ═══ */}
        {S.tab === "settings" && <IncomeTab mob={S.mob} p1Name={S.p1Name} setP1Name={S.setP1Name} p2Name={S.p2Name} setP2Name={S.setP2Name} cSal={S.cSal} setCS={S.setCS} kSal={S.kSal} setKS={S.setKS} cEaip={S.cEaip} setCE={S.setCE} kEaip={S.kEaip} setKE={S.setKE} fil={S.fil} setFil={S.setFil} c4pre={S.c4pre} setC4pre={S.setC4pre} c4ro={S.c4ro} setC4ro={S.setC4ro} k4pre={S.k4pre} setK4pre={S.setK4pre} k4ro={S.k4ro} setK4ro={S.setK4ro} tax={S.tax} upTax={S.upTax} preDed={S.preDed} setPreDed={S.setPreDed} postDed={S.postDed} setPostDed={S.setPostDed} C={S.C} />}

        {/* ═══ CATEGORIES ═══ */}
        {S.tab === "cats" && <CategoriesTab mob={S.mob} cats={S.cats} setCats={S.setCats} newCat={S.newCat} setNewCat={S.setNewCat} savCats={S.savCats} setSavCats={S.setSavCats} transferCats={S.transferCats} setTransferCats={S.setTransferCats} incomeCats={S.incomeCats} setIncomeCats={S.setIncomeCats} exp={S.exp} setExp={S.setExp} sav={S.sav} setSav={S.setSav} transactions={S.transactions} setTransactions={S.setTransactions} />}

        {/* ═══ BUDGET — Live subtab ═══ */}
        {S.tab === "budget" && S.budgetSubtab === "live" && <BudgetTab mob={S.mob} C={S.C} moC={S.moC} y4={S.y4} y5={S.y5} visCols={S.visCols} p1Name={S.p1Name} p2Name={S.p2Name} tax={S.tax} preDed={S.preDed} postDed={S.postDed} showPerPerson={S.showPerPerson} collapsed={S.collapsed} toggleSec={S.toggleSec} necI={S.necI} disI={S.disI} savSorted={S.savSorted} cats={S.cats} savCats={S.savCats} updExp={S.updExp} updSav={S.updSav} rmExp={S.rmExp} rmSav={S.rmSav} tNW={S.tNW} tDW={S.tDW} tExpW={S.tExpW} tSavW={S.tSavW} remW={S.remW} remY48={S.remY48} remY52={S.remY52} totalSavPlusRemW={S.totalSavPlusRemW} showAddItem={S.showAddItem} setShowAddItem={S.setShowAddItem} niN={S.niN} setNiN={S.setNiN} niC={S.niC} setNiC={S.setNiC} niT={S.niT} setNiT={S.setNiT} niS={S.niS} setNiS={S.setNiS} niP={S.niP} setNiP={S.setNiP} niV={S.niV} setNiV={S.setNiV} exp={S.exp} setExp={S.setExp} sav={S.sav} setSav={S.setSav} showBulkAdd={S.showBulkAdd} setShowBulkAdd={S.setShowBulkAdd} bulkName={S.bulkName} setBulkName={S.setBulkName} bulkVal={S.bulkVal} setBulkVal={S.setBulkVal} bulkPer={S.bulkPer} setBulkPer={S.setBulkPer} bulkType={S.bulkType} setBulkType={S.setBulkType} bulkSec={S.bulkSec} setBulkSec={S.setBulkSec} bulkCat={S.bulkCat} setBulkCat={S.setBulkCat} bulkTargets={S.bulkTargets} setBulkTargets={S.setBulkTargets} milestones={S.milestones} setMilestones={S.setMilestones} recalcMilestone={S.recalcMilestone} />}

        {/* ═══ BUDGET — Milestones subtab. Toggles between list mode (no milestone selected)
             and detail mode (viewingMs set). MilestoneViewTab is now inlined here instead
             of being its own top-level page. ═══ */}
        {S.tab === "budget" && S.budgetSubtab === "milestones" && S.viewingMs === null && (
          <MilestonesSubtab mob={S.mob} milestones={S.milestones} setMilestones={S.setMilestones} msHistView={S.msHistView} setMsHistView={S.setMsHistView} msHistYear={S.msHistYear} setMsHistYear={S.setMsHistYear} setViewingMs={S.setViewingMs} setRestoreConfirm={S.setRestoreConfirm} />
        )}
        {S.tab === "budget" && S.budgetSubtab === "milestones" && S.viewingMs !== null && S.milestones[S.viewingMs] && (
          <MilestoneViewTab mob={S.mob} viewingMs={S.viewingMs} setViewingMs={S.setViewingMs} milestones={S.milestones} setMilestones={S.setMilestones} recalcMilestone={S.recalcMilestone} msVisCols={S.msVisCols} setMsVisCols={S.setMsVisCols} p1Name={S.p1Name} p2Name={S.p2Name} tax={S.tax} allTaxDB={S.allTaxDB} fil={S.fil} cats={S.cats} savCats={S.savCats} setRestoreConfirm={S.setRestoreConfirm} />
        )}

        {/* Restore confirm modal — lives at the budget tab level so it can be triggered
             from both the milestone list and from inside MilestoneViewTab. */}
        {S.tab === "budget" && S.budgetSubtab === "milestones" && S.restoreConfirm !== null && S.milestones[S.restoreConfirm] && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => S.setRestoreConfirm(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background: "var(--card-bg, #fff)", borderRadius: 16, padding: 32, maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 800 }}>Restore Milestone?</h3>
              <p style={{ fontSize: 14, color: "var(--tx2,#555)", margin: "0 0 8px" }}>This will replace your <strong>entire current budget</strong> with:</p>
              <div style={{ padding: "10px 14px", background: "var(--input-bg, #f8f8f8)", borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, color: "var(--tx,#333)" }}>{S.milestones[S.restoreConfirm]?.label}</div>
                <div style={{ fontSize: 12, color: "var(--tx3,#888)" }}>{S.milestones[S.restoreConfirm]?.date}</div>
              </div>
              <p style={{ fontSize: 13, color: "#E8573A", margin: "0 0 20px" }}>Consider saving a milestone of your current budget first.</p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => S.setRestoreConfirm(null)} style={{ padding: "9px 20px", border: "2px solid var(--bdr, #ddd)", borderRadius: 8, background: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--tx3,#888)" }}>Cancel</button>
                <button onClick={() => { S.restoreFullState(S.restoreConfirm); S.setRestoreConfirm(null); S.setViewingMs(null); S.setBudgetSubtab("live"); }} style={{ padding: "9px 20px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Restore</button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ CHARTS — Trends subtab (default) ═══ */}
        {S.tab === "charts" && S.chartsSubtab === "trends" && <ChartsTab mob={S.mob} C={S.C} p1Name={S.p1Name} p2Name={S.p2Name} tax={S.tax} milestones={S.milestones} setMilestones={S.setMilestones} cSal={S.cSal} kSal={S.kSal} cEaip={S.cEaip} kEaip={S.kEaip} fil={S.fil} preDed={S.preDed} postDed={S.postDed} c4pre={S.c4pre} c4ro={S.c4ro} k4pre={S.k4pre} k4ro={S.k4ro} exp={S.exp} sav={S.sav} cats={S.cats} savCats={S.savCats} transferCats={S.transferCats} incomeCats={S.incomeCats} transactions={S.transactions} ewk={S.ewk} savSorted={S.savSorted} tNW={S.tNW} tDW={S.tDW} tExpW={S.tExpW} tSavW={S.tSavW} remW={S.remW} totalSavPlusRemW={S.totalSavPlusRemW} savRateBase={S.savRateBase} setSavRateBase={S.setSavRateBase} includeEaip={S.includeEaip} setIncludeEaip={S.setIncludeEaip} chartWeeks={S.chartWeeks} setChartWeeks={S.setChartWeeks} chartTimeWindow={S.chartTimeWindow} setChartTimeWindow={S.setChartTimeWindow} catTot={S.catTot} typTot={S.typTot} PieTooltip={S.PieTooltip} dragWrapRender={S.dragWrapRender} chartOrder={S.chartOrder} necDisMode={S.necDisMode} setNecDisMode={S.setNecDisMode} catHistMode={S.catHistMode} setCatHistMode={S.setCatHistMode} itemHistMode={S.itemHistMode} setItemHistMode={S.setItemHistMode} catHistoryName={S.catHistoryName} setCatHistoryName={S.setCatHistoryName} itemHistoryName={S.itemHistoryName} setItemHistoryName={S.setItemHistoryName} st={S.st} restoreLiveState={S.restoreLiveState} />}

        {/* ═══ CHARTS — Forecast subtab (was top-level Forecast tab pre-restructure) ═══ */}
        {S.tab === "charts" && S.chartsSubtab === "forecast" && <ForecastTab mob={S.mob} C={S.C} tSavW={S.tSavW} remW={S.remW} tExpW={S.tExpW} totalSavPlusRemW={S.totalSavPlusRemW} includeEaip={S.includeEaip} transactions={S.transactions} cats={S.cats} savCats={S.savCats} transferCats={S.transferCats} incomeCats={S.incomeCats} preDed={S.preDed} hsaEmployerMatchAnnual={S.tax?.hsaEmployerMatch || 0} forecast={S.forecast} setForecast={S.setForecast} tax={S.tax} setTax={S.setTax} p1Name={S.p1Name} p2Name={S.p2Name} cSal={S.cSal} kSal={S.kSal} c4pre={S.c4pre} c4ro={S.c4ro} k4pre={S.k4pre} k4ro={S.k4ro} />}

        {/* ═══ TRANSACTIONS ═══ */}
        {S.tab === "transactions" && <TransactionsTab
          mob={S.mob}
          transactions={S.transactions}
          transactionColumns={S.transactionColumns}
          hiddenColumns={S.hiddenColumns}
          setHiddenColumns={S.setHiddenColumns}
          rowCapWarn={S.rowCapWarn}
          rowCapThreshold={S.rowCapThreshold}
          cats={S.cats}
          savCats={S.savCats}
          transferCats={S.transferCats}
          incomeCats={S.incomeCats}
          milestones={S.milestones}
          exp={S.exp}
          sav={S.sav}
          addTransactions={S.addTransactions}
          updateTransaction={S.updateTransaction}
          deleteTransactions={S.deleteTransactions}
          setTransactions={S.setTransactions}
          importProfiles={S.importProfiles}
          setImportProfiles={S.setImportProfiles}
          transactionRules={S.transactionRules}
          setTransactionRules={S.setTransactionRules}
          transferToleranceAmount={S.transferToleranceAmount}
          transferToleranceDays={S.transferToleranceDays}
          transferConfidenceThreshold={S.transferConfidenceThreshold}
          defaultTxPageSize={S.defaultTxPageSize}
          txLoaded={S.txLoaded}
        />}

        {/* ═══ SETTINGS (prefs) ═══ */}
        {S.tab === "prefs" && <SettingsTab
          mob={S.mob}
          transactionColumns={S.transactionColumns}
          setTransactionColumns={S.setTransactionColumns}
          hiddenColumns={S.hiddenColumns}
          setHiddenColumns={S.setHiddenColumns}
          rowCapWarn={S.rowCapWarn}
          setRowCapWarn={S.setRowCapWarn}
          rowCapThreshold={S.rowCapThreshold}
          setRowCapThreshold={S.setRowCapThreshold}
          defaultTxPageSize={S.defaultTxPageSize}
          setDefaultTxPageSize={S.setDefaultTxPageSize}
          transactions={S.transactions}
          setTransactions={S.setTransactions}
          updateTransaction={S.updateTransaction}
          importProfiles={S.importProfiles}
          setImportProfiles={S.setImportProfiles}
          transactionRules={S.transactionRules}
          setTransactionRules={S.setTransactionRules}
          cats={S.cats}
          savCats={S.savCats}
          transferCats={S.transferCats}
          transferToleranceAmount={S.transferToleranceAmount}
          setTransferToleranceAmount={S.setTransferToleranceAmount}
          transferToleranceDays={S.transferToleranceDays}
          setTransferToleranceDays={S.setTransferToleranceDays}
          transferConfidenceThreshold={S.transferConfidenceThreshold}
          setTransferConfidenceThreshold={S.setTransferConfidenceThreshold}
          treatRefundsAsNetting={S.treatRefundsAsNetting}
          setTreatRefundsAsNetting={S.setTreatRefundsAsNetting}
          deleteImportBatch={S.deleteImportBatch}
        />}
      </div>
    </div>
    </VisColsCtx.Provider>
  );
}

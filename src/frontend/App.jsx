import { useRef } from "react";
import { VisColsCtx } from "./components/ui.jsx";
import useAppState from "./hooks/useAppState.jsx";
import CategoriesTab from "./tabs/CategoriesTab.jsx";
import IncomeTab from "./tabs/IncomeTab.jsx";
import TaxRatesTab from "./tabs/TaxRatesTab.jsx";
import BudgetTab, { BudgetToolbar } from "./tabs/BudgetTab.jsx";
import ChartsTab from "./tabs/ChartsTab.jsx";
import SnapshotViewTab from "./tabs/SnapshotViewTab.jsx";
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
            <button style={S.ts(S.tab === "forecast")} onClick={() => S.setTab("forecast")}>Forecast</button>
            <button style={S.ts(S.tab === "cats")} onClick={() => S.setTab("cats")}>Categories</button>
            <button style={S.ts(S.tab === "prefs")} onClick={() => S.setTab("prefs")}>Settings</button>
          </div>
        </div>
        {/* Banner + Toolbar - inside sticky header, only on budget tab */}
        {S.tab === "budget" && S.viewingSnap === null && <BudgetToolbar mob={S.mob} dk={S.dk} waf={S.waf} C={S.C} moC={S.moC} y4={S.y4} y5={S.y5} tSavW={S.tSavW} remY52={S.remY52} bannerOpen={S.bannerOpen} setBannerOpen={S.setBannerOpen} toolbarOpen={S.toolbarOpen} setToolbarOpen={S.setToolbarOpen} visCols={S.visCols} setVisCols={S.setVisCols} sortBy={S.sortBy} setSortBy={S.setSortBy} sortDir={S.sortDir} setSortDir={S.setSortDir} hlThresh={S.hlThresh} setHlThresh={S.setHlThresh} hlPeriod={S.hlPeriod} setHlPeriod={S.setHlPeriod} showPerPerson={S.showPerPerson} setShowPerPerson={S.setShowPerPerson} isMixed={S.isMixed} allExpanded={S.allExpanded} expandAll={S.expandAll} collapseAll={S.collapseAll} toggleAll={S.toggleAll} setShowAddItem={S.setShowAddItem} setShowBulkAdd={S.setShowBulkAdd} cats={S.cats} setBulkTargets={S.setBulkTargets} setBulkName={S.setBulkName} setBulkVal={S.setBulkVal} setBulkCat={S.setBulkCat} snapshots={S.snapshots} />}
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: S.mob ? "12px 10px 60px" : "24px 20px 60px" }}>

        {/* ═══ TAX RATES ═══ */}
        {S.tab === "taxes" && <TaxRatesTab mob={S.mob} tax={S.tax} upTax={S.upTax} upP1State={S.upP1State} upP2State={S.upP2State} setTax={S.setTax} p1Name={S.p1Name} p2Name={S.p2Name} fil={S.fil} C={S.C} allTaxDB={S.allTaxDB} loadTaxYear={S.loadTaxYear} showTaxPaste={S.showTaxPaste} setShowTaxPaste={S.setShowTaxPaste} taxPaste={S.taxPaste} setTaxPaste={S.setTaxPaste} addTaxYear={S.addTaxYear} fetchStatus={S.fetchStatus} setFetchStatus={S.setFetchStatus} />}

        {/* ═══ INCOME ═══ */}
        {S.tab === "settings" && <IncomeTab mob={S.mob} p1Name={S.p1Name} setP1Name={S.setP1Name} p2Name={S.p2Name} setP2Name={S.setP2Name} cSal={S.cSal} setCS={S.setCS} kSal={S.kSal} setKS={S.setKS} cEaip={S.cEaip} setCE={S.setCE} kEaip={S.kEaip} setKE={S.setKE} fil={S.fil} setFil={S.setFil} c4pre={S.c4pre} setC4pre={S.setC4pre} c4ro={S.c4ro} setC4ro={S.setC4ro} k4pre={S.k4pre} setK4pre={S.setK4pre} k4ro={S.k4ro} setK4ro={S.setK4ro} tax={S.tax} upTax={S.upTax} preDed={S.preDed} setPreDed={S.setPreDed} postDed={S.postDed} setPostDed={S.setPostDed} C={S.C} />}

        {/* ═══ CATEGORIES ═══ */}
        {S.tab === "cats" && <CategoriesTab mob={S.mob} cats={S.cats} setCats={S.setCats} newCat={S.newCat} setNewCat={S.setNewCat} savCats={S.savCats} setSavCats={S.setSavCats} exp={S.exp} setExp={S.setExp} sav={S.sav} setSav={S.setSav} />}

        {/* ═══ BUDGET SNAPSHOT VIEW ═══ */}
        {S.tab === "budget" && S.viewingSnap !== null && S.snapshots[S.viewingSnap] && <SnapshotViewTab mob={S.mob} viewingSnap={S.viewingSnap} setViewingSnap={S.setViewingSnap} snapshots={S.snapshots} setSnapshots={S.setSnapshots} recalcSnap={S.recalcSnap} snapVisCols={S.snapVisCols} setSnapVisCols={S.setSnapVisCols} snapTab={S.snapTab} setSnapTab={S.setSnapTab} p1Name={S.p1Name} p2Name={S.p2Name} tax={S.tax} allTaxDB={S.allTaxDB} fil={S.fil} cats={S.cats} savCats={S.savCats} />}

        {S.tab === "budget" && S.viewingSnap === null && <BudgetTab mob={S.mob} C={S.C} moC={S.moC} y4={S.y4} y5={S.y5} visCols={S.visCols} p1Name={S.p1Name} p2Name={S.p2Name} tax={S.tax} preDed={S.preDed} postDed={S.postDed} showPerPerson={S.showPerPerson} collapsed={S.collapsed} toggleSec={S.toggleSec} necI={S.necI} disI={S.disI} savSorted={S.savSorted} cats={S.cats} savCats={S.savCats} updExp={S.updExp} updSav={S.updSav} rmExp={S.rmExp} rmSav={S.rmSav} tNW={S.tNW} tDW={S.tDW} tExpW={S.tExpW} tSavW={S.tSavW} remW={S.remW} remY48={S.remY48} remY52={S.remY52} totalSavPlusRemW={S.totalSavPlusRemW} showAddItem={S.showAddItem} setShowAddItem={S.setShowAddItem} niN={S.niN} setNiN={S.setNiN} niC={S.niC} setNiC={S.setNiC} niT={S.niT} setNiT={S.setNiT} niS={S.niS} setNiS={S.setNiS} niP={S.niP} setNiP={S.setNiP} niV={S.niV} setNiV={S.setNiV} exp={S.exp} setExp={S.setExp} sav={S.sav} setSav={S.setSav} showBulkAdd={S.showBulkAdd} setShowBulkAdd={S.setShowBulkAdd} bulkName={S.bulkName} setBulkName={S.setBulkName} bulkVal={S.bulkVal} setBulkVal={S.setBulkVal} bulkPer={S.bulkPer} setBulkPer={S.setBulkPer} bulkType={S.bulkType} setBulkType={S.setBulkType} bulkSec={S.bulkSec} setBulkSec={S.setBulkSec} bulkCat={S.bulkCat} setBulkCat={S.setBulkCat} bulkTargets={S.bulkTargets} setBulkTargets={S.setBulkTargets} snapshots={S.snapshots} setSnapshots={S.setSnapshots} recalcSnap={S.recalcSnap} />}

        {/* ═══ CHARTS ═══ */}
        {S.tab === "charts" && <ChartsTab mob={S.mob} C={S.C} p1Name={S.p1Name} p2Name={S.p2Name} tax={S.tax} snapshots={S.snapshots} setSnapshots={S.setSnapshots} snapDate={S.snapDate} setSnapDate={S.setSnapDate} snapLabel={S.snapLabel} setSnapLabel={S.setSnapLabel} cSal={S.cSal} kSal={S.kSal} cEaip={S.cEaip} kEaip={S.kEaip} fil={S.fil} preDed={S.preDed} postDed={S.postDed} c4pre={S.c4pre} c4ro={S.c4ro} k4pre={S.k4pre} k4ro={S.k4ro} exp={S.exp} sav={S.sav} cats={S.cats} ewk={S.ewk} savSorted={S.savSorted} tNW={S.tNW} tDW={S.tDW} tExpW={S.tExpW} tSavW={S.tSavW} remW={S.remW} totalSavPlusRemW={S.totalSavPlusRemW} savRateBase={S.savRateBase} setSavRateBase={S.setSavRateBase} includeEaip={S.includeEaip} setIncludeEaip={S.setIncludeEaip} chartWeeks={S.chartWeeks} setChartWeeks={S.setChartWeeks} catTot={S.catTot} typTot={S.typTot} PieTooltip={S.PieTooltip} dragWrapRender={S.dragWrapRender} chartOrder={S.chartOrder} necDisMode={S.necDisMode} setNecDisMode={S.setNecDisMode} catHistMode={S.catHistMode} setCatHistMode={S.setCatHistMode} itemHistMode={S.itemHistMode} setItemHistMode={S.setItemHistMode} catHistoryName={S.catHistoryName} setCatHistoryName={S.setCatHistoryName} itemHistoryName={S.itemHistoryName} setItemHistoryName={S.setItemHistoryName} snapHistView={S.snapHistView} setSnapHistView={S.setSnapHistView} snapHistYear={S.snapHistYear} setSnapHistYear={S.setSnapHistYear} setViewingSnap={S.setViewingSnap} setTab={S.setTab} restoreConfirm={S.restoreConfirm} setRestoreConfirm={S.setRestoreConfirm} restoreFullState={S.restoreFullState} st={S.st} restoreLiveState={S.restoreLiveState} />}

        {/* ═══ FORECAST ═══ */}
        {S.tab === "forecast" && <ForecastTab mob={S.mob} C={S.C} tSavW={S.tSavW} remW={S.remW} tExpW={S.tExpW} totalSavPlusRemW={S.totalSavPlusRemW} includeEaip={S.includeEaip} />}

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
          addTransactions={S.addTransactions}
          updateTransaction={S.updateTransaction}
          deleteTransactions={S.deleteTransactions}
          setTransactions={S.setTransactions}
          importProfiles={S.importProfiles}
          setImportProfiles={S.setImportProfiles}
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
          transactions={S.transactions}
          importProfiles={S.importProfiles}
          setImportProfiles={S.setImportProfiles}
          deleteImportBatch={S.deleteImportBatch}
        />}
      </div>
    </div>
    </VisColsCtx.Provider>
  );
}

/* ── Tax Rate Database: 1996–2026 ── */
/* Federal brackets [from, to, rate], stdDed, SS, Medicare, 401k, HSA(family) */
export const TAX_DB = {
  "1996": { fedSingle:[[0,24000,.15],[24000,58150,.28],[58150,121300,.31],[121300,263750,.36],[263750,9999999,.396]], fedMFJ:[[0,40100,.15],[40100,96900,.28],[96900,147700,.31],[147700,263750,.36],[263750,9999999,.396]], stdSingle:4000, stdMFJ:6700, ssRate:6.2, ssCap:62700, medRate:1.45, k401Lim:9500, hsaLimit:0 },
  "1997": { fedSingle:[[0,24650,.15],[24650,59750,.28],[59750,124650,.31],[124650,271050,.36],[271050,9999999,.396]], fedMFJ:[[0,41200,.15],[41200,99600,.28],[99600,151750,.31],[151750,271050,.36],[271050,9999999,.396]], stdSingle:4150, stdMFJ:6900, ssRate:6.2, ssCap:65400, medRate:1.45, k401Lim:9500, hsaLimit:0 },
  "1998": { fedSingle:[[0,25350,.15],[25350,61400,.28],[61400,128100,.31],[128100,278450,.36],[278450,9999999,.396]], fedMFJ:[[0,42350,.15],[42350,102300,.28],[102300,155950,.31],[155950,278450,.36],[278450,9999999,.396]], stdSingle:4250, stdMFJ:7100, ssRate:6.2, ssCap:68400, medRate:1.45, k401Lim:10000, hsaLimit:0 },
  "1999": { fedSingle:[[0,25750,.15],[25750,62450,.28],[62450,130250,.31],[130250,283150,.36],[283150,9999999,.396]], fedMFJ:[[0,43050,.15],[43050,104050,.28],[104050,158550,.31],[158550,283150,.36],[283150,9999999,.396]], stdSingle:4300, stdMFJ:7200, ssRate:6.2, ssCap:72600, medRate:1.45, k401Lim:10000, hsaLimit:0 },
  "2000": { fedSingle:[[0,26250,.15],[26250,63550,.28],[63550,132600,.31],[132600,288350,.36],[288350,9999999,.396]], fedMFJ:[[0,43850,.15],[43850,105950,.28],[105950,161450,.31],[161450,288350,.36],[288350,9999999,.396]], stdSingle:4400, stdMFJ:7350, ssRate:6.2, ssCap:76200, medRate:1.45, k401Lim:10500, hsaLimit:0 },
  "2001": { fedSingle:[[0,27050,.15],[27050,65550,.28],[65550,136750,.31],[136750,297350,.36],[297350,9999999,.396]], fedMFJ:[[0,45200,.15],[45200,109250,.28],[109250,166500,.31],[166500,297350,.36],[297350,9999999,.396]], stdSingle:4550, stdMFJ:7600, ssRate:6.2, ssCap:80400, medRate:1.45, k401Lim:10500, hsaLimit:0 },
  "2002": { fedSingle:[[0,6000,.10],[6000,27950,.15],[27950,67700,.27],[67700,141250,.30],[141250,307050,.35],[307050,9999999,.386]], fedMFJ:[[0,12000,.10],[12000,46700,.15],[46700,112850,.27],[112850,171950,.30],[171950,307050,.35],[307050,9999999,.386]], stdSingle:4700, stdMFJ:7850, ssRate:6.2, ssCap:84900, medRate:1.45, k401Lim:11000, hsaLimit:0 },
  "2003": { fedSingle:[[0,7000,.10],[7000,28400,.15],[28400,68800,.25],[68800,143500,.28],[143500,311950,.33],[311950,9999999,.35]], fedMFJ:[[0,14000,.10],[14000,56800,.15],[56800,114650,.25],[114650,174700,.28],[174700,311950,.33],[311950,9999999,.35]], stdSingle:4750, stdMFJ:9500, ssRate:6.2, ssCap:87000, medRate:1.45, k401Lim:12000, hsaLimit:0 },
  "2004": { fedSingle:[[0,7150,.10],[7150,29050,.15],[29050,70350,.25],[70350,146750,.28],[146750,319100,.33],[319100,9999999,.35]], fedMFJ:[[0,14300,.10],[14300,58100,.15],[58100,117250,.25],[117250,178650,.28],[178650,319100,.33],[319100,9999999,.35]], stdSingle:4850, stdMFJ:9700, ssRate:6.2, ssCap:87900, medRate:1.45, k401Lim:13000, hsaLimit:5150 },
  "2005": { fedSingle:[[0,7300,.10],[7300,29700,.15],[29700,71950,.25],[71950,150150,.28],[150150,326450,.33],[326450,9999999,.35]], fedMFJ:[[0,14600,.10],[14600,59400,.15],[59400,119950,.25],[119950,182800,.28],[182800,326450,.33],[326450,9999999,.35]], stdSingle:5000, stdMFJ:10000, ssRate:6.2, ssCap:90000, medRate:1.45, k401Lim:14000, hsaLimit:5250 },
  "2006": { fedSingle:[[0,7550,.10],[7550,30650,.15],[30650,74200,.25],[74200,154800,.28],[154800,336550,.33],[336550,9999999,.35]], fedMFJ:[[0,15100,.10],[15100,61300,.15],[61300,123700,.25],[123700,188450,.28],[188450,336550,.33],[336550,9999999,.35]], stdSingle:5150, stdMFJ:10300, ssRate:6.2, ssCap:94200, medRate:1.45, k401Lim:15000, hsaLimit:5450 },
  "2007": { fedSingle:[[0,7825,.10],[7825,31850,.15],[31850,77100,.25],[77100,160850,.28],[160850,349700,.33],[349700,9999999,.35]], fedMFJ:[[0,15650,.10],[15650,63700,.15],[63700,128500,.25],[128500,195850,.28],[195850,349700,.33],[349700,9999999,.35]], stdSingle:5350, stdMFJ:10700, ssRate:6.2, ssCap:97500, medRate:1.45, k401Lim:15500, hsaLimit:5650 },
  "2008": { fedSingle:[[0,8025,.10],[8025,32550,.15],[32550,78850,.25],[78850,164550,.28],[164550,357700,.33],[357700,9999999,.35]], fedMFJ:[[0,16050,.10],[16050,65100,.15],[65100,131450,.25],[131450,200300,.28],[200300,357700,.33],[357700,9999999,.35]], stdSingle:5450, stdMFJ:10900, ssRate:6.2, ssCap:102000, medRate:1.45, k401Lim:15500, hsaLimit:5800 },
  "2009": { fedSingle:[[0,8350,.10],[8350,33950,.15],[33950,82250,.25],[82250,171550,.28],[171550,372950,.33],[372950,9999999,.35]], fedMFJ:[[0,16700,.10],[16700,67900,.15],[67900,137050,.25],[137050,208850,.28],[208850,372950,.33],[372950,9999999,.35]], stdSingle:5700, stdMFJ:11400, ssRate:6.2, ssCap:106800, medRate:1.45, k401Lim:16500, hsaLimit:5950 },
  "2010": { fedSingle:[[0,8375,.10],[8375,34000,.15],[34000,82400,.25],[82400,171850,.28],[171850,373650,.33],[373650,9999999,.35]], fedMFJ:[[0,16750,.10],[16750,68000,.15],[68000,137300,.25],[137300,209250,.28],[209250,373650,.33],[373650,9999999,.35]], stdSingle:5700, stdMFJ:11400, ssRate:6.2, ssCap:106800, medRate:1.45, k401Lim:16500, hsaLimit:6150 },
  "2011": { fedSingle:[[0,8500,.10],[8500,34500,.15],[34500,83600,.25],[83600,174400,.28],[174400,379150,.33],[379150,9999999,.35]], fedMFJ:[[0,17000,.10],[17000,69000,.15],[69000,139350,.25],[139350,212300,.28],[212300,379150,.33],[379150,9999999,.35]], stdSingle:5800, stdMFJ:11600, ssRate:4.2, ssCap:106800, medRate:1.45, k401Lim:16500, hsaLimit:6150 },
  "2012": { fedSingle:[[0,8700,.10],[8700,35350,.15],[35350,85650,.25],[85650,178650,.28],[178650,388350,.33],[388350,9999999,.35]], fedMFJ:[[0,17400,.10],[17400,70700,.15],[70700,142700,.25],[142700,217450,.28],[217450,388350,.33],[388350,9999999,.35]], stdSingle:5950, stdMFJ:11900, ssRate:4.2, ssCap:110100, medRate:1.45, k401Lim:17000, hsaLimit:6250 },
  "2013": { fedSingle:[[0,8925,.10],[8925,36250,.15],[36250,87850,.25],[87850,183250,.28],[183250,398350,.33],[398350,400000,.35],[400000,9999999,.396]], fedMFJ:[[0,17850,.10],[17850,72500,.15],[72500,146400,.25],[146400,223050,.28],[223050,398350,.33],[398350,450000,.35],[450000,9999999,.396]], stdSingle:6100, stdMFJ:12200, ssRate:6.2, ssCap:113700, medRate:1.45, k401Lim:17500, hsaLimit:6450 },
  "2014": { fedSingle:[[0,9075,.10],[9075,36900,.15],[36900,89350,.25],[89350,186350,.28],[186350,405100,.33],[405100,406750,.35],[406750,9999999,.396]], fedMFJ:[[0,18150,.10],[18150,73800,.15],[73800,148850,.25],[148850,226850,.28],[226850,405100,.33],[405100,457600,.35],[457600,9999999,.396]], stdSingle:6200, stdMFJ:12400, ssRate:6.2, ssCap:117000, medRate:1.45, k401Lim:17500, hsaLimit:6550 },
  "2015": { fedSingle:[[0,9225,.10],[9225,37450,.15],[37450,90750,.25],[90750,189300,.28],[189300,411500,.33],[411500,413200,.35],[413200,9999999,.396]], fedMFJ:[[0,18450,.10],[18450,74900,.15],[74900,151200,.25],[151200,230450,.28],[230450,411500,.33],[411500,464850,.35],[464850,9999999,.396]], stdSingle:6300, stdMFJ:12600, ssRate:6.2, ssCap:118500, medRate:1.45, k401Lim:18000, hsaLimit:6650 },
  "2016": { fedSingle:[[0,9275,.10],[9275,37650,.15],[37650,91150,.25],[91150,190150,.28],[190150,413350,.33],[413350,415050,.35],[415050,9999999,.396]], fedMFJ:[[0,18550,.10],[18550,75300,.15],[75300,151900,.25],[151900,231450,.28],[231450,413350,.33],[413350,466950,.35],[466950,9999999,.396]], stdSingle:6300, stdMFJ:12600, ssRate:6.2, ssCap:118500, medRate:1.45, k401Lim:18000, hsaLimit:6750 },
  "2017": { fedSingle:[[0,9325,.10],[9325,37950,.15],[37950,91900,.25],[91900,191650,.28],[191650,416700,.33],[416700,418400,.35],[418400,9999999,.396]], fedMFJ:[[0,18650,.10],[18650,75900,.15],[75900,153100,.25],[153100,233350,.28],[233350,416700,.33],[416700,470700,.35],[470700,9999999,.396]], stdSingle:6350, stdMFJ:12700, ssRate:6.2, ssCap:127200, medRate:1.45, k401Lim:18000, hsaLimit:6750 },
  "2018": { fedSingle:[[0,9525,.10],[9525,38700,.12],[38700,82500,.22],[82500,157500,.24],[157500,200000,.32],[200000,500000,.35],[500000,9999999,.37]], fedMFJ:[[0,19050,.10],[19050,77400,.12],[77400,165000,.22],[165000,315000,.24],[315000,400000,.32],[400000,600000,.35],[600000,9999999,.37]], stdSingle:12000, stdMFJ:24000, ssRate:6.2, ssCap:128400, medRate:1.45, k401Lim:18500, hsaLimit:6900 },
  "2019": { fedSingle:[[0,9700,.10],[9700,39475,.12],[39475,84200,.22],[84200,160725,.24],[160725,204100,.32],[204100,510300,.35],[510300,9999999,.37]], fedMFJ:[[0,19400,.10],[19400,78950,.12],[78950,168400,.22],[168400,321450,.24],[321450,408200,.32],[408200,612350,.35],[612350,9999999,.37]], stdSingle:12200, stdMFJ:24400, ssRate:6.2, ssCap:132900, medRate:1.45, k401Lim:19000, hsaLimit:7000 },
  "2020": { fedSingle:[[0,9875,.10],[9875,40125,.12],[40125,85525,.22],[85525,163300,.24],[163300,207350,.32],[207350,518400,.35],[518400,9999999,.37]], fedMFJ:[[0,19750,.10],[19750,80250,.12],[80250,171050,.22],[171050,326600,.24],[326600,414700,.32],[414700,622050,.35],[622050,9999999,.37]], stdSingle:12400, stdMFJ:24800, ssRate:6.2, ssCap:137700, medRate:1.45, k401Lim:19500, hsaLimit:7100 },
  "2021": { fedSingle:[[0,9950,.10],[9950,40525,.12],[40525,86375,.22],[86375,164925,.24],[164925,209425,.32],[209425,523600,.35],[523600,9999999,.37]], fedMFJ:[[0,19900,.10],[19900,81050,.12],[81050,172750,.22],[172750,329850,.24],[329850,418850,.32],[418850,628300,.35],[628300,9999999,.37]], stdSingle:12550, stdMFJ:25100, ssRate:6.2, ssCap:142800, medRate:1.45, k401Lim:19500, hsaLimit:7200 },
  "2022": { fedSingle:[[0,10275,.10],[10275,41775,.12],[41775,89075,.22],[89075,170050,.24],[170050,215950,.32],[215950,539900,.35],[539900,9999999,.37]], fedMFJ:[[0,20550,.10],[20550,83550,.12],[83550,178150,.22],[178150,340100,.24],[340100,431900,.32],[431900,647850,.35],[647850,9999999,.37]], stdSingle:12950, stdMFJ:25900, ssRate:6.2, ssCap:147000, medRate:1.45, k401Lim:20500, hsaLimit:7300 },
  "2023": { fedSingle:[[0,11000,.10],[11000,44725,.12],[44725,95375,.22],[95375,182100,.24],[182100,231250,.32],[231250,578125,.35],[578125,9999999,.37]], fedMFJ:[[0,22000,.10],[22000,89450,.12],[89450,190750,.22],[190750,364200,.24],[364200,462500,.32],[462500,693750,.35],[693750,9999999,.37]], stdSingle:13850, stdMFJ:27700, ssRate:6.2, ssCap:160200, medRate:1.45, k401Lim:22500, hsaLimit:7750 },
  "2024": { fedSingle:[[0,11600,.10],[11600,47150,.12],[47150,100525,.22],[100525,191950,.24],[191950,243725,.32],[243725,609350,.35],[609350,9999999,.37]], fedMFJ:[[0,23200,.10],[23200,94300,.12],[94300,201050,.22],[201050,383900,.24],[383900,487450,.32],[487450,731200,.35],[731200,9999999,.37]], stdSingle:14600, stdMFJ:29200, ssRate:6.2, ssCap:168600, medRate:1.45, k401Lim:23000, hsaLimit:8300 },
  "2025": { fedSingle:[[0,11925,.10],[11925,48475,.12],[48475,103350,.22],[103350,197300,.24],[197300,250525,.32],[250525,626350,.35],[626350,9999999,.37]], fedMFJ:[[0,23850,.10],[23850,96950,.12],[96950,206700,.22],[206700,394600,.24],[394600,501050,.32],[501050,751600,.35],[751600,9999999,.37]], stdSingle:15000, stdMFJ:30000, ssRate:6.2, ssCap:176100, medRate:1.45, k401Lim:23500, hsaLimit:8550 },
  "2026": { fedSingle:[[0,12400,.10],[12400,50400,.12],[50400,105700,.22],[105700,201775,.24],[201775,256225,.32],[256225,640600,.35],[640600,9999999,.37]], fedMFJ:[[0,24800,.10],[24800,100800,.12],[100800,211400,.22],[211400,403550,.24],[403550,512450,.32],[512450,768700,.35],[768700,9999999,.37]], stdSingle:16100, stdMFJ:32200, ssRate:6.2, ssCap:184500, medRate:1.45, k401Lim:24500, hsaLimit:8300 },
};

export const DEF_TAX = {
  year: "2026",
  ...TAX_DB["2026"],
  p1State: { name: "Colorado", abbr: "CO", famli: 0.45 },
  p2State: { name: "Colorado", abbr: "CO", famli: 0.45 },
  k401Lim: 24500,
  c401Catch: 0, c401CatchPreTax: true,
  k401Catch: 0, k401CatchPreTax: true,
  cMatchTiers: [{ upTo: 4, rate: 1 }, { upTo: 6, rate: 0.5 }], cMatchBase: 6,
  kMatchTiers: [{ upTo: 4, rate: 1 }, { upTo: 6, rate: 0.5 }], kMatchBase: 6,
  hsaLimit: 8300, hsaEmployerMatch: 0,
  /* Birth years (4-digit) for catch-up tier resolution in the forecast.
     Empty/0 = no catch-up applied (graceful default for the generic build
     where personal data is zeroed). User opts in via Income tab. */
  p1BirthYear: 0,
  p2BirthYear: 0,
};

export const STATE_ABBR = {"Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC"};

export const STATE_TAX = {"AL":5.0,"AK":0,"AZ":2.5,"AR":3.9,"CA":13.3,"CO":4.4,"CT":6.99,"DE":6.6,"FL":0,"GA":5.49,"HI":11,"ID":5.695,"IL":4.95,"IN":3.05,"IA":5.7,"KS":5.7,"KY":4.0,"LA":4.25,"ME":7.15,"MD":5.75,"MA":5.0,"MI":4.25,"MN":9.85,"MS":5.0,"MO":4.8,"MT":5.9,"NE":5.84,"NV":0,"NH":0,"NJ":10.75,"NM":5.9,"NY":10.9,"NC":4.5,"ND":1.95,"OH":3.5,"OK":4.75,"OR":9.9,"PA":3.07,"RI":5.99,"SC":6.4,"SD":0,"TN":0,"TX":0,"UT":4.65,"VT":8.75,"VA":5.75,"WA":0,"WV":5.12,"WI":7.65,"WY":0,"DC":10.75};

/* Employee-share state payroll tax % (PFML/SDI/FAMLI/TDI). 2026 rates. 0 = no employee payroll tax. */
export const STATE_PAYROLL = {"AL":0,"AK":0,"AZ":0,"AR":0,"CA":1.3,"CO":0.45,"CT":0.5,"DE":0.5,"FL":0,"GA":0,"HI":0.5,"ID":0,"IL":0,"IN":0,"IA":0,"KS":0,"KY":0,"LA":0,"ME":0.5,"MD":0.5,"MA":0.46,"MI":0,"MN":0.5,"MS":0,"MO":0,"MT":0,"NE":0,"NV":0,"NH":0,"NJ":0.42,"NM":0,"NY":0.432,"NC":0,"ND":0,"OH":0,"OK":0,"OR":0.6,"PA":0,"RI":1.1,"SC":0,"SD":0,"TN":0,"TX":0,"UT":0,"VT":0,"VA":0,"WA":0.808,"WV":0,"WI":0,"WY":0,"DC":0};

export const STATE_BRACKETS = {
  "AL":{single:[[0,500,.02],[500,3000,.04],[3000,9999999,.05]],mfj:[[0,1000,.02],[1000,6000,.04],[6000,9999999,.05]],stdSingle:2500,stdMFJ:7500},
  "AK":{single:[],mfj:[],stdSingle:0,stdMFJ:0},
  "AZ":{single:[[0,9999999,.025]],mfj:[[0,9999999,.025]],stdSingle:14600,stdMFJ:29200},
  "AR":{single:[[0,5100,.02],[5100,20400,.04],[20400,9999999,.039]],mfj:[[0,5100,.02],[5100,20400,.04],[20400,9999999,.039]],stdSingle:2340,stdMFJ:4680},
  "CA":{single:[[0,10412,.01],[10412,24684,.02],[24684,38959,.04],[38959,54081,.06],[54081,68350,.08],[68350,349137,.093],[349137,418961,.103],[418961,698271,.113],[698271,9999999,.133]],mfj:[[0,20824,.01],[20824,49368,.02],[49368,77918,.04],[77918,108162,.06],[108162,136700,.08],[136700,698274,.093],[698274,837922,.103],[837922,1396542,.113],[1396542,9999999,.133]],stdSingle:5540,stdMFJ:11080},
  "CO":{single:[[0,9999999,.044]],mfj:[[0,9999999,.044]],stdSingle:0,stdMFJ:0},
  "CT":{single:[[0,10000,.03],[10000,50000,.05],[50000,100000,.055],[100000,200000,.06],[200000,250000,.065],[250000,500000,.069],[500000,9999999,.0699]],mfj:[[0,20000,.03],[20000,100000,.05],[100000,200000,.055],[200000,400000,.06],[400000,500000,.065],[500000,1000000,.069],[1000000,9999999,.0699]],stdSingle:0,stdMFJ:0},
  "DE":{single:[[0,2000,0],[2000,5000,.022],[5000,10000,.039],[10000,20000,.048],[20000,25000,.052],[25000,60000,.0555],[60000,9999999,.066]],mfj:[[0,2000,0],[2000,5000,.022],[5000,10000,.039],[10000,20000,.048],[20000,25000,.052],[25000,60000,.0555],[60000,9999999,.066]],stdSingle:3250,stdMFJ:6500},
  "FL":{single:[],mfj:[],stdSingle:0,stdMFJ:0},
  "GA":{single:[[0,9999999,.0549]],mfj:[[0,9999999,.0549]],stdSingle:12000,stdMFJ:24000},
  "HI":{single:[[0,2400,.014],[2400,4800,.032],[4800,9600,.055],[9600,14400,.064],[14400,19200,.068],[19200,24000,.072],[24000,36000,.076],[36000,48000,.079],[48000,150000,.0825],[150000,175000,.09],[175000,200000,.10],[200000,9999999,.11]],mfj:[[0,4800,.014],[4800,9600,.032],[9600,19200,.055],[19200,28800,.064],[28800,38400,.068],[38400,48000,.072],[48000,72000,.076],[72000,96000,.079],[96000,300000,.0825],[300000,350000,.09],[350000,400000,.10],[400000,9999999,.11]],stdSingle:2200,stdMFJ:4400},
  "ID":{single:[[0,9999999,.05695]],mfj:[[0,9999999,.05695]],stdSingle:14600,stdMFJ:29200},
  "IL":{single:[[0,9999999,.0495]],mfj:[[0,9999999,.0495]],stdSingle:0,stdMFJ:0},
  "IN":{single:[[0,9999999,.0305]],mfj:[[0,9999999,.0305]],stdSingle:0,stdMFJ:0},
  "IA":{single:[[0,6210,.044],[6210,31050,.0482],[31050,9999999,.057]],mfj:[[0,6210,.044],[6210,31050,.0482],[31050,9999999,.057]],stdSingle:2210,stdMFJ:5450},
  "KS":{single:[[0,15000,.031],[15000,30000,.0525],[30000,9999999,.057]],mfj:[[0,30000,.031],[30000,60000,.0525],[60000,9999999,.057]],stdSingle:3500,stdMFJ:8000},
  "KY":{single:[[0,9999999,.04]],mfj:[[0,9999999,.04]],stdSingle:3160,stdMFJ:6320},
  "LA":{single:[[0,12500,.0185],[12500,50000,.035],[50000,9999999,.0425]],mfj:[[0,25000,.0185],[25000,100000,.035],[100000,9999999,.0425]],stdSingle:0,stdMFJ:0},
  "ME":{single:[[0,26050,.058],[26050,61600,.0675],[61600,9999999,.0715]],mfj:[[0,52100,.058],[52100,123200,.0675],[123200,9999999,.0715]],stdSingle:14600,stdMFJ:29200},
  "MD":{single:[[0,1000,.02],[1000,2000,.03],[2000,3000,.04],[3000,100000,.0475],[100000,125000,.05],[125000,150000,.0525],[150000,250000,.055],[250000,9999999,.0575]],mfj:[[0,1500,.02],[1500,3000,.03],[3000,4500,.04],[4500,150000,.0475],[150000,187500,.05],[187500,225000,.0525],[225000,375000,.055],[375000,9999999,.0575]],stdSingle:2550,stdMFJ:5100},
  "MA":{single:[[0,9999999,.05]],mfj:[[0,9999999,.05]],stdSingle:0,stdMFJ:0},
  "MI":{single:[[0,9999999,.0425]],mfj:[[0,9999999,.0425]],stdSingle:5600,stdMFJ:11200},
  "MN":{single:[[0,31690,.0535],[31690,104090,.068],[104090,183340,.0785],[183340,9999999,.0985]],mfj:[[0,63380,.0535],[63380,208180,.068],[208180,366680,.0785],[366680,9999999,.0985]],stdSingle:14575,stdMFJ:29150},
  "MS":{single:[[0,10000,0],[10000,9999999,.05]],mfj:[[0,10000,0],[10000,9999999,.05]],stdSingle:2300,stdMFJ:4600},
  "MO":{single:[[0,1207,.02],[1207,2414,.025],[2414,3621,.03],[3621,4828,.035],[4828,6035,.04],[6035,7242,.045],[7242,8449,.05],[8449,9999999,.048]],mfj:[[0,1207,.02],[1207,2414,.025],[2414,3621,.03],[3621,4828,.035],[4828,6035,.04],[6035,7242,.045],[7242,8449,.05],[8449,9999999,.048]],stdSingle:14600,stdMFJ:29200},
  "MT":{single:[[0,20500,.047],[20500,9999999,.059]],mfj:[[0,20500,.047],[20500,9999999,.059]],stdSingle:14600,stdMFJ:29200},
  "NE":{single:[[0,3700,.0246],[3700,22170,.0351],[22170,35730,.0501],[35730,9999999,.0584]],mfj:[[0,7400,.0246],[7400,44340,.0351],[44340,71460,.0501],[71460,9999999,.0584]],stdSingle:7900,stdMFJ:15800},
  "NV":{single:[],mfj:[],stdSingle:0,stdMFJ:0},
  "NH":{single:[],mfj:[],stdSingle:0,stdMFJ:0},
  "NJ":{single:[[0,20000,.014],[20000,35000,.0175],[35000,40000,.035],[40000,75000,.05525],[75000,500000,.0637],[500000,1000000,.0897],[1000000,9999999,.1075]],mfj:[[0,20000,.014],[20000,35000,.0175],[35000,40000,.035],[40000,75000,.05525],[75000,500000,.0637],[500000,1000000,.0897],[1000000,9999999,.1075]],stdSingle:0,stdMFJ:0},
  "NM":{single:[[0,5500,.017],[5500,11000,.032],[11000,16000,.047],[16000,210000,.049],[210000,9999999,.059]],mfj:[[0,11000,.017],[11000,22000,.032],[22000,32000,.047],[32000,420000,.049],[420000,9999999,.059]],stdSingle:14600,stdMFJ:29200},
  "NY":{single:[[0,8500,.04],[8500,11700,.045],[11700,13900,.0525],[13900,80650,.055],[80650,215400,.06],[215400,1077550,.0685],[1077550,5000000,.0965],[5000000,25000000,.103],[25000000,9999999,.109]],mfj:[[0,8500,.04],[8500,11700,.045],[11700,13900,.0525],[13900,80650,.055],[80650,215400,.06],[215400,1077550,.0685],[1077550,5000000,.0965],[5000000,25000000,.103],[25000000,9999999,.109]],stdSingle:8000,stdMFJ:16050},
  "NC":{single:[[0,9999999,.045]],mfj:[[0,9999999,.045]],stdSingle:14600,stdMFJ:29200},
  "ND":{single:[[0,44725,.0195]],mfj:[[0,89450,.0195]],stdSingle:14600,stdMFJ:29200},
  "OH":{single:[[0,26050,0],[26050,100000,.025],[100000,9999999,.035]],mfj:[[0,26050,0],[26050,100000,.025],[100000,9999999,.035]],stdSingle:0,stdMFJ:0},
  "OK":{single:[[0,1000,.0025],[1000,2500,.0075],[2500,3750,.0175],[3750,4900,.0275],[4900,7200,.0375],[7200,9999999,.0475]],mfj:[[0,2000,.0025],[2000,5000,.0075],[5000,7500,.0175],[7500,9800,.0275],[9800,14400,.0375],[14400,9999999,.0475]],stdSingle:7350,stdMFJ:14700},
  "OR":{single:[[0,4050,.0475],[4050,10200,.0675],[10200,125000,.0875],[125000,9999999,.099]],mfj:[[0,8100,.0475],[8100,20400,.0675],[20400,250000,.0875],[250000,9999999,.099]],stdSingle:2745,stdMFJ:5495},
  "PA":{single:[[0,9999999,.0307]],mfj:[[0,9999999,.0307]],stdSingle:0,stdMFJ:0},
  "RI":{single:[[0,73450,.0375],[73450,166950,.0475],[166950,9999999,.0599]],mfj:[[0,73450,.0375],[73450,166950,.0475],[166950,9999999,.0599]],stdSingle:10550,stdMFJ:21100},
  "SC":{single:[[0,3460,0],[3460,17330,.03],[17330,9999999,.064]],mfj:[[0,3460,0],[3460,17330,.03],[17330,9999999,.064]],stdSingle:14600,stdMFJ:29200},
  "SD":{single:[],mfj:[],stdSingle:0,stdMFJ:0},
  "TN":{single:[],mfj:[],stdSingle:0,stdMFJ:0},
  "TX":{single:[],mfj:[],stdSingle:0,stdMFJ:0},
  "UT":{single:[[0,9999999,.0465]],mfj:[[0,9999999,.0465]],stdSingle:0,stdMFJ:0},
  "VT":{single:[[0,45400,.0335],[45400,110050,.066],[110050,229550,.076],[229550,9999999,.0875]],mfj:[[0,90800,.0335],[90800,220100,.066],[220100,459100,.076],[459100,9999999,.0875]],stdSingle:14600,stdMFJ:29200},
  "VA":{single:[[0,3000,.02],[3000,5000,.03],[5000,17000,.05],[17000,9999999,.0575]],mfj:[[0,3000,.02],[3000,5000,.03],[5000,17000,.05],[17000,9999999,.0575]],stdSingle:4500,stdMFJ:9000},
  "WA":{single:[],mfj:[],stdSingle:0,stdMFJ:0},
  "WV":{single:[[0,10000,.0236],[10000,25000,.0315],[25000,40000,.0354],[40000,60000,.0472],[60000,9999999,.0512]],mfj:[[0,10000,.0236],[10000,25000,.0315],[25000,40000,.0354],[40000,60000,.0472],[60000,9999999,.0512]],stdSingle:0,stdMFJ:0},
  "WI":{single:[[0,14320,.0354],[14320,28640,.0465],[28640,315310,.053],[315310,9999999,.0765]],mfj:[[0,27208,.0354],[27208,54416,.0465],[54416,599089,.053],[599089,9999999,.0765]],stdSingle:13230,stdMFJ:24500},
  "WY":{single:[],mfj:[],stdSingle:0,stdMFJ:0},
  "DC":{single:[[0,10000,.04],[10000,40000,.06],[40000,60000,.065],[60000,250000,.085],[250000,500000,.0925],[500000,1000000,.0975],[1000000,9999999,.1075]],mfj:[[0,10000,.04],[10000,40000,.06],[40000,60000,.065],[60000,250000,.085],[250000,500000,.0925],[500000,1000000,.0975],[1000000,9999999,.1075]],stdSingle:14600,stdMFJ:29200},
};

export const DEF_CATS = ["Automotive","Clothing","Entertainment","Fees","Fun Money","General","Groceries","Healthcare","Housing","Internet","Personal Care","Pet Care","Phone","Restaurants","Student Loans","Taxes","Utilities"];
export const DEF_PRE = [{n:"Medical",c:"0",k:"0"},{n:"Dental",c:"0",k:"0"},{n:"Vision",c:"0",k:"0"},{n:"HSA",c:"0",k:"0"}];
export const DEF_POST = [{n:"Identity Protection",c:"0",k:"0"},{n:"Legal",c:"0",k:"0"},{n:"Group Life Insurance",c:"0",k:"0"}];

export const DEF_EXP = [
  {n:"Car Insurance",c:"Automotive",t:"N",v:"0",p:"m"},{n:"Gas",c:"Automotive",t:"N",v:"0",p:"m"},
  {n:"Corey Car",c:"Automotive",t:"N",v:"0",p:"m"},{n:"Corey Car Registration",c:"Automotive",t:"N",v:"0",p:"m"},
  {n:"Corey Car Maintenance",c:"Automotive",t:"N",v:"0",p:"m"},{n:"Kelly Car",c:"Automotive",t:"N",v:"0",p:"m"},
  {n:"Kelly Car Registration",c:"Automotive",t:"N",v:"0",p:"m"},{n:"Kelly Car Maintenance",c:"Automotive",t:"N",v:"0",p:"m"},
  {n:"Clothing/Shoes",c:"Clothing",t:"N",v:"0",p:"m"},{n:"Credit Card Fees",c:"Fees",t:"D",v:"0",p:"m"},
  {n:"Netflix",c:"Entertainment",t:"D",v:"0",p:"m"},{n:"Disney+",c:"Entertainment",t:"D",v:"0",p:"m"},
  {n:"Hulu",c:"Entertainment",t:"D",v:"0",p:"m"},{n:"Spotify",c:"Entertainment",t:"D",v:"0",p:"m"},
  {n:"Disney",c:"Entertainment",t:"D",v:"0",p:"m"},{n:"Public Activities",c:"Entertainment",t:"D",v:"0",p:"m"},
  {n:"Audible",c:"Entertainment",t:"D",v:"0",p:"m"},{n:"Corey Fun Money",c:"Fun Money",t:"D",v:"0",p:"m"},
  {n:"Kelly Fun Money",c:"Fun Money",t:"D",v:"0",p:"m"},{n:"Misc",c:"General",t:"D",v:"0",p:"m"},
  {n:"Food/Groceries",c:"Groceries",t:"N",v:"0",p:"m"},{n:"Corey Medical",c:"Healthcare",t:"N",v:"0",p:"m"},
  {n:"Kelly Medical",c:"Healthcare",t:"N",v:"0",p:"m"},{n:"Mortgage P&I",c:"Housing",t:"N",v:"0",p:"m"},
  {n:"HOA Fee",c:"Housing",t:"N",v:"0",p:"m"},{n:"Escrow",c:"Housing",t:"N",v:"0",p:"m"},
  {n:"Quantum Fiber",c:"Internet",t:"N",v:"0",p:"m"},{n:"Corey Gym",c:"Personal Care",t:"D",v:"0",p:"m"},
  {n:"Kelly Gym",c:"Personal Care",t:"D",v:"0",p:"m"},{n:"Kelly Waxes",c:"Personal Care",t:"D",v:"0",p:"m"},
  {n:"Haircuts",c:"Personal Care",t:"N",v:"0",p:"m"},{n:"Pet Care",c:"Pet Care",t:"N",v:"0",p:"m"},
  {n:"AT&T",c:"Phone",t:"N",v:"0",p:"m"},{n:"Apple Fees",c:"Phone",t:"D",v:"0",p:"m"},
  {n:"Eating Out",c:"Restaurants",t:"D",v:"0",p:"m"},{n:"SOFI Loan",c:"Student Loans",t:"N",v:"0",p:"m"},
  {n:"Great Lakes Loan",c:"Student Loans",t:"N",v:"0",p:"m"},{n:"CPA",c:"Taxes",t:"N",v:"0",p:"m"},
  {n:"Core Electric",c:"Utilities",t:"N",v:"0",p:"m"},{n:"Black Hills Energy",c:"Utilities",t:"N",v:"0",p:"m"},
  {n:"Castle Rock Water",c:"Utilities",t:"N",v:"0",p:"m"},
];
export const DEF_SAV_CATS = ["Emergency","Short-Term","Long-Term","Retirement","Travel","Home","Education","Other"];
export const DEF_TRANSFER_CATS = ["Transfer","Credit Card Payment","Internal Transfer"];
export const DEF_INCOME_CATS = ["Paycheck","Bonus","Interest","Dividend","Refund","Gift","Other Income"];
export const DEF_SAV = [{n:"House Fund",v:"0",p:"m",c:"Home"},{n:"Emergency Fund",v:"0",p:"m",c:"Emergency"},{n:"Washing Machine",v:"0",p:"m",c:"Home"},{n:"Destination Unknown",v:"0",p:"m",c:"Travel"},{n:"Temporary",v:"0",p:"m",c:"Other"}];

/* ── Forecast contribution limits (account-based forecast) ──
   Per-year IRS limits used by the Forecast tab's advanced (account-based)
   mode. The TAX_DB above carries `k401Lim` (401(k) employee deferral) and
   `hsaLimit` (HSA family) per year for the live tax calc — those values are
   the source of truth when present. The tables below add what TAX_DB doesn't
   carry: IRA limits, HSA self-only limits, and catch-up tier amounts.

   Catch-up tiers (current law):
     - Standard catch-up (50+): adds to 401(k), IRA, HSA
     - Super catch-up (60-63, 401(k) only, SECURE 2.0): replaces standard
     - HSA catch-up (55+): separate amount, smaller than 401(k) catch-up
   At age 64+ the 401(k) super catch-up drops back to standard.

   Years before 2024 either had no super catch-up (didn't exist yet) or
   pre-date HSAs entirely. For projection purposes (which always look forward
   from today) only recent and future years matter; older years are kept
   minimal to avoid bogus historical projections. */
export const IRA_LIMITS = {
  /* IRA contribution limits per person. Catch-up at 50+. */
  "2018": { base: 5500, catchup50: 1000 },
  "2019": { base: 6000, catchup50: 1000 },
  "2020": { base: 6000, catchup50: 1000 },
  "2021": { base: 6000, catchup50: 1000 },
  "2022": { base: 6000, catchup50: 1000 },
  "2023": { base: 6500, catchup50: 1000 },
  "2024": { base: 7000, catchup50: 1000 },
  "2025": { base: 7000, catchup50: 1000 },
  "2026": { base: 7500, catchup50: 1000 },
};

export const HSA_LIMITS_SELF = {
  /* HSA self-only limits per person. Family limit lives in TAX_DB.hsaLimit.
     HSA catch-up is age 55+ and is a separate amount per person. */
  "2018": { self: 3450, catchup55: 1000 },
  "2019": { self: 3500, catchup55: 1000 },
  "2020": { self: 3550, catchup55: 1000 },
  "2021": { self: 3600, catchup55: 1000 },
  "2022": { self: 3650, catchup55: 1000 },
  "2023": { self: 3850, catchup55: 1000 },
  "2024": { self: 4150, catchup55: 1000 },
  "2025": { self: 4300, catchup55: 1000 },
  "2026": { self: 4400, catchup55: 1000 },
};

export const CATCHUP_401K = {
  /* 401(k) catch-up amounts per year. `standard` is age 50+ baseline.
     `super` is the SECURE 2.0 enhanced catch-up for ages 60-63 (drops back
     to standard at 64+). Pre-2025 have no super tier. Catch-up applies on
     top of the base k401Lim from TAX_DB. */
  "2018": { standard: 6000, super: 0 },
  "2019": { standard: 6000, super: 0 },
  "2020": { standard: 6500, super: 0 },
  "2021": { standard: 6500, super: 0 },
  "2022": { standard: 6500, super: 0 },
  "2023": { standard: 7500, super: 0 },
  "2024": { standard: 7500, super: 0 },
  "2025": { standard: 7500, super: 11250 },
  "2026": { standard: 8000, super: 11250 },
};

/* ── Limit pool resolution ──
   Returns the IRS limit for a given pool, year, and age. Pools are how
   contributions group across accounts that share a tax treatment:

     401k_employee  — pre-tax 401k + Roth 401k (per person)
     ira            — traditional IRA + Roth IRA (per person)
     hsa            — household pool, self-or-family driven by `hsaCoverage`

   `age` is optional; if provided, catch-up amounts are added per the
   age-tier rules above. `hsaCoverage` is "family" | "self" | "both-self"
   (latter doubles the self limit since each person gets their own).

   Returns the numeric annual limit, or Infinity if the pool has no IRS
   limit (taxable accounts, custom accounts).

   The function intentionally falls back to the most recent year in the
   table when asked for a future year — projection horizons run 30+ years
   into the future and IRS limits aren't published that far ahead. Better
   to project today's limit forward than to hallucinate growth. */
export function getPoolLimit(pool, year, age, hsaCoverage = "family") {
  const yr = String(year);
  // Find the closest year ≤ requested, then fall back to highest if none.
  const yearsList = (db) => Object.keys(db).sort();
  const resolve = (db) => {
    if (db[yr]) return db[yr];
    const keys = yearsList(db);
    const earlier = keys.filter(k => k <= yr).pop();
    if (earlier) return db[earlier];
    return db[keys[keys.length - 1]]; // future-year: use latest known
  };
  const tierFor401k = (a) => {
    if (a == null) return "none";
    if (a >= 64) return "standard";
    if (a >= 60) return "super";
    if (a >= 50) return "standard";
    return "none";
  };
  const tierForIRA = (a) => (a != null && a >= 50) ? "standard" : "none";
  const tierForHSA = (a) => (a != null && a >= 55) ? "standard" : "none";

  if (pool === "401k_employee") {
    const taxRow = TAX_DB[yr] || TAX_DB[yearsList(TAX_DB).filter(k => k <= yr).pop() || Object.keys(TAX_DB).sort().slice(-1)[0]];
    const base = taxRow ? taxRow.k401Lim : 24500;
    const catchupRow = resolve(CATCHUP_401K);
    const tier = tierFor401k(age);
    const catchup = tier === "super" ? catchupRow.super : tier === "standard" ? catchupRow.standard : 0;
    return base + catchup;
  }
  if (pool === "ira") {
    const row = resolve(IRA_LIMITS);
    return row.base + (tierForIRA(age) === "standard" ? row.catchup50 : 0);
  }
  if (pool === "hsa") {
    const taxRow = TAX_DB[yr] || TAX_DB[Object.keys(TAX_DB).sort().filter(k => k <= yr).pop() || Object.keys(TAX_DB).sort().slice(-1)[0]];
    const familyLim = taxRow ? taxRow.hsaLimit : 8300;
    const selfRow = resolve(HSA_LIMITS_SELF);
    const catchup = tierForHSA(age) === "standard" ? selfRow.catchup55 : 0;
    if (hsaCoverage === "self") return selfRow.self + catchup;
    if (hsaCoverage === "both-self") return (selfRow.self + catchup) * 2;
    return familyLim + catchup; // family default
  }
  return Infinity; // taxable, cash, custom
}

/* Map of account `type` → limit pool. Used by forecast math to bucket
   account-level contributions into pools for limit checking. */
export const ACCOUNT_TYPE_TO_POOL = {
  "401k_pretax": "401k_employee",
  "401k_roth":   "401k_employee",
  "ira_traditional": "ira",
  "ira_roth":        "ira",
  "hsa":     "hsa",
  "taxable": null,
  "cash":    null,
  "custom":  null,
};

/* Default account list for first-time advanced-mode users. */
export function defaultForecastAccounts() {
  return [
    { id: "acc_p1_401k_pretax", name: "P1 401(k) — Pre-tax", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 7, contribOverride: false, contribAmount: 0, annualIncrease: 0, capAtLimit: true },
    { id: "acc_p1_401k_roth",   name: "P1 401(k) — Roth",    owner: "p1", type: "401k_roth",   startBalance: 0, annualReturn: 7, contribOverride: false, contribAmount: 0, annualIncrease: 0, capAtLimit: true },
    { id: "acc_p2_401k_pretax", name: "P2 401(k) — Pre-tax", owner: "p2", type: "401k_pretax", startBalance: 0, annualReturn: 7, contribOverride: false, contribAmount: 0, annualIncrease: 0, capAtLimit: true },
    { id: "acc_p2_401k_roth",   name: "P2 401(k) — Roth",    owner: "p2", type: "401k_roth",   startBalance: 0, annualReturn: 7, contribOverride: false, contribAmount: 0, annualIncrease: 0, capAtLimit: true },
    { id: "acc_hsa_family",     name: "HSA — Family",        owner: "joint", type: "hsa",      startBalance: 0, annualReturn: 7, contribOverride: false, contribAmount: 0, annualIncrease: 0, capAtLimit: true },
    { id: "acc_cash_joint",     name: "Cash / Taxable",      owner: "joint", type: "taxable",  startBalance: 0, annualReturn: 4, contribOverride: false, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
  ];
}

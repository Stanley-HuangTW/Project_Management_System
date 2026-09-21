from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

OUT = '軍規智慧移動載具_AMR_系統整合與技術開發規劃報告.docx'
NAVY = '17365D'
LIGHT = 'EAF1F8'
GRID = 'D9D9D9'

def shade(cell, color):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd'); shd.set(qn('w:fill'), color); tcpr.append(shd)

def border(cell):
    tcpr = cell._tc.get_or_add_tcPr()
    b = OxmlElement('w:tcBorders')
    for side in ('top','left','bottom','right','insideH','insideV'):
        e = OxmlElement(f'w:{side}'); e.set(qn('w:val'),'single'); e.set(qn('w:sz'),'6'); e.set(qn('w:color'),GRID); b.append(e)
    tcpr.append(b)

def set_font(run, size=10.5, bold=False, color=None):
    run.font.name = 'Microsoft JhengHei'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft JhengHei')
    run._element.rPr.rFonts.set(qn('w:ascii'), 'Aptos')
    run.font.size = Pt(size); run.font.bold = bold
    if color: run.font.color.rgb = RGBColor.from_string(color)

def para(doc, text='', style=None, before=0, after=6, boldlead=None):
    p = doc.add_paragraph(style=style)
    p.paragraph_format.space_before = Pt(before); p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.line_spacing = 1.35
    if boldlead and text.startswith(boldlead):
        set_font(p.add_run(boldlead), 10.5, True)
        set_font(p.add_run(text[len(boldlead):]))
    else: set_font(p.add_run(text))
    return p

def heading(doc, text, level=1):
    p = doc.add_paragraph(style=f'Heading {level}')
    p.paragraph_format.space_before = Pt(14 if level == 1 else 8); p.paragraph_format.space_after = Pt(6)
    r = p.add_run(text); set_font(r, 14 if level == 1 else 11.5, True, '000000')
    return p

def table(doc, headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers)); t.alignment = WD_TABLE_ALIGNMENT.CENTER; t.style = 'Table Grid'
    t.autofit = False
    for i,h in enumerate(headers):
        c=t.rows[0].cells[i]; shade(c,NAVY); border(c); c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
        p=c.paragraphs[0]; p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after=Pt(2); p.paragraph_format.space_before=Pt(2)
        set_font(p.add_run(h),9.5,True,'FFFFFF')
        if widths: c.width=Cm(widths[i])
    for ridx,row in enumerate(rows):
        cells=t.add_row().cells
        for i,v in enumerate(row):
            c=cells[i]; border(c); c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if ridx%2==1: shade(c,LIGHT)
            p=c.paragraphs[0]; p.paragraph_format.space_before=Pt(2); p.paragraph_format.space_after=Pt(2); p.paragraph_format.line_spacing=1.15
            p.alignment=WD_ALIGN_PARAGRAPH.CENTER if i==0 else WD_ALIGN_PARAGRAPH.LEFT
            set_font(p.add_run(v),9.2)
            if widths: c.width=Cm(widths[i])
    doc.add_paragraph().paragraph_format.space_after=Pt(2)
    return t

doc=Document(); sec=doc.sections[0]
sec.top_margin=Cm(2.1); sec.bottom_margin=Cm(2.0); sec.left_margin=Cm(2.1); sec.right_margin=Cm(2.1)
styles=doc.styles
styles['Normal'].font.name='Microsoft JhengHei'; styles['Normal']._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft JhengHei'); styles['Normal'].font.size=Pt(10.5)
for s in ('Title','Heading 1','Heading 2'):
    styles[s].font.color.rgb=RGBColor(0,0,0)

p=doc.add_paragraph(style='Title'); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after=Pt(10)
set_font(p.add_run('軍規智慧移動載具 AMR 系統整合與技術開發規劃報告'), 20, True)
p=doc.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after=Pt(20)
set_font(p.add_run('提報版本｜2026 年 9 月'),11,False,'555555')

heading(doc,'一 報告摘要')
para(doc,'本規劃以既有 C300 AMR 平台為基礎，建構可在複雜戶外環境執行人員隨行、語意感知、物資運輸與高風險任務支援的智慧移動載具能力。近期最具時效的方向，是以 AMR BOX 與中科院體系的 Ghost 機器狗進行自主定位、導航與避障整合，形成可立即展演、具新聞性與後續採購延展性的合作亮點。')
para(doc,'建議採雙軌推動：第一軌以 AI 多模態 Follow Me、路面語意分割與 Ghost 機器狗展示，快速產出可視察、可報導的成果；第二軌同步完成 AMR BOX 跨載具工程化與合規門檻，使合作可由概念驗證銜接至採購與產品化。', boldlead='建議：')

heading(doc,'二 立即合作機會與展示亮點')
para(doc,'對方已表達 AMR BOX 可對接多項專案，並希望儘速取得報價、啟動採購程序；金額與 NRE 並非當前主要障礙。院方期待的核心是能迅速形成有新聞性的技術亮點，因此建議先以可控範圍的展示專案完成第一階段合作，再擴展至任務載具整合。')
table(doc,['優先級','合作機會','近期合作成果'],[
['P0','Ghost 機器狗：飛彈所前瞻組負責單位與 AMR BOX 整合。','自主定位、導航、避障與跟隨展示；作為對外亮點主軸。'],
['P0','我方越野載具搭載院方機械手臂。','完成機械手臂通訊、載具協調與遙控安全互鎖概念驗證。'],
['P1','400 公斤履帶無人車：中科院與車輛中心合作案。','三方對接控制介面、任務需求與合作模式。'],
['P1','遙控槍塔控制整合。','完成介面、安全權限與控制責任邊界評估；不得逾越授權範圍。'],
], [1.5,6.5,8.8])
para(doc,'建議在首次技術對接會議前，準備 AMR BOX 功能簡介、目標載具介面清單、分階段報價架構及展示驗收指標。展示應聚焦「不用 RTK 仍能自主安全移動」與「跨載具快速移植」兩項可被直觀理解的成果。')

heading(doc,'三 核心功能與 AI 視覺應用')
heading(doc,'2.1 AI 多模態隨行系統',2)
para(doc,'系統導入 AI 人形與特徵辨識演算法，取代傳統無線標籤依賴。AMR 透過可見光與深度等感知資料建立目標人員身分與位置的持續追蹤，在遮蔽、隊形變化與人員交錯情境下維持安全距離與跟隨穩定性。')
para(doc,'展示情境可設定為人員在戶外場域移動、轉向、短暫遮擋及停駐時，載具依任務規則完成隨行、等待與重新捕捉。功能驗收應同時衡量跟隨成功率、重新識別時間、最小安全距離與人工介入次數。')
heading(doc,'2.2 全場景語意分割與移動限制',2)
para(doc,'採用即時路面語意分割辨識柏油、泥濘、草地及指定戰術路面，並將辨識結果映射為可行駛成本、速度上限與禁入規則。系統可將懸崖、邊坡、非通行區及任務禁區設定為語意邊界，形成虛擬圍籬並支援智慧避障。')
table(doc,['能力','預期運作方式','展示或任務價值'],[
['目標人員跟隨','人形與特徵辨識結合軌跡預測，維持可設定的安全距離。','降低標籤依賴，呈現戰術隨行能力。'],
['路面理解','即時辨識路面材質並切換速度、驅動與避障參數。','提高非結構化場域通過性。'],
['虛擬圍籬','以語意邊界及任務地圖定義禁入、減速與停等區。','避免進入危險或非授權區域。'],
], [3.2,7.2,6.4])

heading(doc,'四 次世代 AMR 控制艙 AMR BOX')
para(doc,'AMR BOX 定位為不依賴原車 VCU 的通用導航與避障控制模組，整合感知介面、定位融合、任務規劃、即時推論及安全控制。透過標準化電源、通訊、感測器與致動器介面，使同一核心軟體能部署於 C300、四足機器人及其他移動載具。')
heading(doc,'3.1 跨平台移植與交付目標',2)
table(doc,['階段','主要工作','主要產出'],[
['2026 Q4','需求凍結、介面盤點、感知與控制架構選型。','系統需求規格、ICD 與測試計畫。'],
['2027 H1','AMR BOX 工程樣機、C300 整合與場域測試。','工程樣機、導航避障功能驗證。'],
['2027 H2','T95 四足機器人移植與首台樣機交付。','首台整合樣機及驗證報告。'],
], [2.6,7.5,6.7])
heading(doc,'3.2 硬體環境適應性',2)
para(doc,'與 T95 專業單位共同定義外掛安裝、供電、震動、接頭與維修條件。硬體目標為高防水防塵與被動散熱；IP65 或 IP67、防震等級、溫度範圍及連續滿載熱設計，應在設計凍結前轉為可量測的驗收規格，而非僅作目標宣示。')

heading(doc,'五 無 RTK 戰場極端環境導航方案')
para(doc,'在衛星定位不可用或 RTK 受干擾時，系統採視覺慣性里程計 VIO、光達里程計與 SLAM、輪速與 IMU 等多源資訊進行航位推算，並以 AI 地形感知建立可通行區、風險區與障礙物成本圖。此架構參考軍規戶外自主平台的能力方向，但不將外部產品能力視為本系統已完成之證據。')
para(doc,'目標是在 75 公尺半徑的未知動態環境中，完成局部建圖、即時路徑規劃與避障。技術驗證應採漸進方式，先驗證感測冗餘與失效切換，再建立遮蔽、粉塵、低照度、動態人車及定位漂移情境的量化測試。')
table(doc,['能力層','核心技術','失效應變'],[
['定位','VIO、光達里程計 SLAM、IMU 與輪速融合。','定位品質下降時降速、重定位或安全停車。'],
['感知','AI 地形理解、障礙物偵測與自由空間估測。','感知置信度不足時提高安全距離並請求人工確認。'],
['規劃','局部成本地圖、動態避障與任務規則。','無可行路徑時停等、返航或切換遙控模式。'],
], [2.4,7.6,6.8])

heading(doc,'六 戰術任務應用支援')
para(doc,'平台採模組化任務載荷設計，優先支援傷員護送、物資運輸與拖曳任務；後續可整合機械手臂執行彈藥搬運與 EOD 輔助作業。涉及爆炸物或彈藥的任務，必須建立明確的人機權限、保險互鎖、遙控接管與作業程序，並由具資格人員驗證。')
table(doc,['任務模組','系統需求','安全重點'],[
['傷員護送與物資運輸','負載穩定、拖曳能力、坡度與路面適應。','重心監控、緊急停車、失聯安全模式。'],
['彈藥搬運','機械手臂、載具協調控制與任務流程。','操作權限、碰撞限制、人工接管。'],
['EOD 輔助','高精度遙控與視覺回傳。','由授權人員決策，不授權自主危險處置。'],
], [3.3,6.8,6.7])

heading(doc,'七 後端架構與資安合規')
para(doc,'系統採邊緣與區域算力中心協同架構：AMR BOX 在現場完成低延遲感知、避障與安全決策；經授權、加密與最小化處理後，將必要的任務與異常資料回傳客戶內部區域算力中心，用於模型再訓練、版本管理與辨識優化。所有模型更新應經簽章驗證、回歸測試與可回復機制後部署。')
table(doc,['合規目標','落實措施','驗證證據'],[
['非紅供應鏈','建立 BOM、韌體、軟體元件與供應鏈原產地清冊，排除不符規範來源。','供應商聲明、採購紀錄與版本稽核。'],
['無陸資背景','針對股權、實質受益人及供應鏈進行盡職調查。','公司治理與供應商查核文件。'],
['ISO 27001 資安認證','建立 ISMS、權限控管、漏洞管理與事件應變；可向合作單位取得實務處理經驗。','適用性聲明、稽核紀錄與認證狀態。'],
], [3.0,7.0,6.8])
para(doc,'與中科院合作的基本先決條件為：取得 ISO 27001 資安認證、無陸資背景及符合非紅供應鏈要求。合作單位可分享 ISO 27001 導入與文件處理經驗；本公司仍應獨立完成制度建置、認證與供應鏈證據整備。', boldlead='合作門檻：')
para(doc,'上述合規項目應以法規、契約與採購機關的最新要求為準；在取得可稽核證據前，建議以「規劃目標」表述，不宜宣稱已完成認證或完全符合。', boldlead='合規提醒：')

heading(doc,'八 關鍵風險與執行建議')
table(doc,['風險','可能影響','建議控制措施'],[
['感知在惡劣天候失效','跟隨、避障或地形判斷可靠度下降。','多感測器冗餘、置信度監控、降級策略與測試資料閉環。'],
['跨載具介面差異','移植時程延誤或控制行為不一致。','提早凍結 ICD，採硬體抽象層與模擬器先行驗證。'],
['散熱與防護衝突','密封後熱累積造成降頻或故障。','熱模擬、環境測試、被動散熱與可維修性共同設計。'],
['供應鏈與資安證據不足','軍方採購或驗收障礙。','建立可追溯 SBOM、BOM 與供應商稽核機制。'],
], [3.4,6.2,7.2])
para(doc,'建議立即啟動三項工作：第一，與飛彈所前瞻組確立 Ghost 機器狗整合範圍、展示 KPI 與對外敘事；第二，完成 AMR BOX 報價、跨載具 ICD 與越野載具機械手臂的概念驗證規劃；第三，針對 400 公斤履帶無人車、車輛中心與中科院進行三方技術對接，同步建立 ISO 27001、無陸資與非紅供應鏈的稽核清單。此三項工作可讓短期亮點、採購進程與長期產品化共享同一套架構與驗證資料。')

footer=sec.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.CENTER; set_font(footer.add_run('軍規智慧移動載具 AMR 系統整合與技術開發規劃報告'),8,False,'666666')
doc.save(OUT)
print(OUT)

// api/index.js 내 /api/bus/routes 부분 교체
app.get('/api/bus/routes', async (req, res) => {
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();
  if (!serviceKey) return res.status(500).json({ status: 'error', message: 'API 키 누락' });

  if (masterRouteListCache) {
    return res.json({ status: 'success', routes: masterRouteListCache });
  }

  const url = `https://apis.data.go.kr/6300000/busRouteInfo/getRouteInfoAll?serviceKey=${serviceKey}&reqPage=1`;
  try {
    const response = await axios.get(url, { timeout: 10000 });
    parser.parseString(response.data, (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'XML 파싱 실패' });

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) {
        return res.json({ status: 'success', routes: [] });
      }

      const list = Array.isArray(body.itemList) ? body.itemList : [body.itemList];
      
      const formatted = list.map(item => {
        const routeNo = (item.ROUTE_NO || item.busRouteNm || '').trim();
        const originNm = (item.ORIGIN_NM || item.stStationNm || item.startStation || '').trim();
        const destNm = (item.DEST_NM || item.edStationNm || item.endStation || '').trim();
        const routeTp = (item.ROUTE_TP || '').trim();

        let type = 'trunk';
        if (routeTp === '1' || routeNo.includes('급행')) type = 'express';
        else if (routeTp === '3' || routeNo.startsWith('1') || routeNo.startsWith('2') || routeNo.startsWith('5')) type = 'branch';

        return {
          id: (item.ROUTE_CD || item.busRouteId || '').trim(),
          name: routeNo,
          type: type,
          originName: originNm || '기점정류장',
          destName: destNm || '종점정류장',
          desc: `${originNm || '기점'} ↔ ${destNm || '종점'}`
        };
      }).filter(r => r.id && r.name);

      masterRouteListCache = formatted;
      res.json({ status: 'success', count: formatted.length, routes: formatted });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

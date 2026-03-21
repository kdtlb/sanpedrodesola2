const map = L.map('map', {
    zoomControl: true
}).setView([-21.5355, -64.7296], 11);

const streetsLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
});

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri'
});

streetsLayer.addTo(map);
let isSatelliteView = false;

const courseSlicer = document.getElementById('courseSlicer');
const waypointList = document.getElementById('waypointList');
const exportGpxBtn = document.getElementById('exportGpxBtn');
const mapThemeToggle = document.getElementById('mapThemeToggle');
const mapThemeLabel = document.getElementById('mapThemeLabel');
const mapThemeDot = document.getElementById('mapThemeDot');
const logoWrapper = document.getElementById('logoWrapper');
const headerLogo = document.getElementById('headerLogo');

const statDistance = document.getElementById('statDistance');
const statElevation = document.getElementById('statElevation');
const distCurrent = document.getElementById('distCurrent');
const distEnd = document.getElementById('distEnd');
const currentPointName = document.getElementById('currentPointName');
const currentElevation = document.getElementById('currentElevation');
const currentLat = document.getElementById('currentLat');
const currentLng = document.getElementById('currentLng');
const dataSourceLabel = document.getElementById('dataSourceLabel');

let fullRouteCoords = [];
let routeMeta = [];
let checkpoints = [];
let routeLine = null;
let progressLine = null;
let currentMarker = null;
let checkpointMarkers = [];
let elevationChart = null;
let cumulativeDistances = [];
let totalDistanceKm = 0;
let totalElevationGain = 0;

const fallbackGeoJSON = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "name": "Andes Ultra 50K - Ejemplo",
                "type": "route"
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [-64.7300, -21.5350, 1850],
                    [-64.7280, -21.5320, 1880],
                    [-64.7250, -21.5280, 1930],
                    [-64.7210, -21.5230, 1990],
                    [-64.7170, -21.5190, 2050],
                    [-64.7130, -21.5160, 2120],
                    [-64.7090, -21.5120, 2180],
                    [-64.7050, -21.5080, 2240],
                    [-64.7000, -21.5030, 2290],
                    [-64.6960, -21.4990, 2340],
                    [-64.6920, -21.4950, 2400],
                    [-64.6880, -21.4910, 2460],
                    [-64.6840, -21.4880, 2420],
                    [-64.6800, -21.4850, 2370],
                    [-64.6760, -21.4830, 2310],
                    [-64.6720, -21.4800, 2260]
                ]
            }
        },
        {
            "type": "Feature",
            "properties": { "name": "Salida", "type": "checkpoint", "index": 0 },
            "geometry": { "type": "Point", "coordinates": [-64.7300, -21.5350, 1850] }
        },
        {
            "type": "Feature",
            "properties": { "name": "CP1 - Quebrada", "type": "checkpoint", "index": 4 },
            "geometry": { "type": "Point", "coordinates": [-64.7170, -21.5190, 2050] }
        },
        {
            "type": "Feature",
            "properties": { "name": "CP2 - Mirador", "type": "checkpoint", "index": 8 },
            "geometry": { "type": "Point", "coordinates": [-64.7000, -21.5030, 2290] }
        },
        {
            "type": "Feature",
            "properties": { "name": "CP3 - Cumbre", "type": "checkpoint", "index": 11 },
            "geometry": { "type": "Point", "coordinates": [-64.6880, -21.4910, 2460] }
        },
        {
            "type": "Feature",
            "properties": { "name": "Meta", "type": "checkpoint", "index": 15 },
            "geometry": { "type": "Point", "coordinates": [-64.6720, -21.4800, 2260] }
        }
    ]
};

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(a));
}

function buildRouteData(geojson) {
    fullRouteCoords = [];
    routeMeta = [];
    checkpoints = [];
    cumulativeDistances = [];
    totalDistanceKm = 0;
    totalElevationGain = 0;

    const routeFeature = geojson.features.find(
        f => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
    );

    if (!routeFeature) {
        throw new Error('El GeoJSON no contiene una geometría LineString ni MultiLineString.');
    }

    let coords = [];

    if (routeFeature.geometry.type === 'LineString') {
        coords = routeFeature.geometry.coordinates;
    } else {
        coords = routeFeature.geometry.coordinates.flat();
    }

    coords.forEach((c, i) => {
        const lng = c[0];
        const lat = c[1];
        const ele = c.length > 2 ? Number(c[2]) : 0;

        fullRouteCoords.push([lat, lng]);
        routeMeta.push({
            lat,
            lng,
            ele,
            name: `Punto ${i + 1}`
        });

        if (i === 0) {
            cumulativeDistances.push(0);
        } else {
            const prev = routeMeta[i - 1];
            const dist = haversine(prev.lat, prev.lng, lat, lng);
            totalDistanceKm += dist;
            cumulativeDistances.push(totalDistanceKm);

            const elevationDiff = ele - prev.ele;
            if (elevationDiff > 0) totalElevationGain += elevationDiff;
        }
    });

    const pointFeatures = geojson.features.filter(
        f => f.geometry && f.geometry.type === 'Point'
    );

    if (pointFeatures.length > 0) {
        checkpoints = pointFeatures.map((f, idx) => {
            let routeIndex = Number(f.properties?.index);

            if (Number.isNaN(routeIndex)) {
                routeIndex = findNearestRouteIndex(
                    f.geometry.coordinates[1],
                    f.geometry.coordinates[0]
                );
            }

            return {
                id: idx,
                name: f.properties?.name || `Checkpoint ${idx + 1}`,
                routeIndex: Math.max(0, Math.min(routeIndex, routeMeta.length - 1)),
                lat: f.geometry.coordinates[1],
                lng: f.geometry.coordinates[0],
                ele: f.geometry.coordinates[2] || routeMeta[Math.max(0, Math.min(routeIndex, routeMeta.length - 1))]?.ele || 0
            };
        }).sort((a, b) => a.routeIndex - b.routeIndex);
    } else {
        checkpoints = generateAutomaticCheckpoints();
    }
}

function generateAutomaticCheckpoints() {
    const total = routeMeta.length - 1;
    const indexes = [
        0,
        Math.floor(total * 0.25),
        Math.floor(total * 0.5),
        Math.floor(total * 0.75),
        total
    ];

    const labels = ['Salida', 'CP1', 'CP2', 'CP3', 'Meta'];

    return indexes.map((index, i) => ({
        id: i,
        name: labels[i],
        routeIndex: index,
        lat: routeMeta[index].lat,
        lng: routeMeta[index].lng,
        ele: routeMeta[index].ele
    }));
}

function findNearestRouteIndex(lat, lng) {
    let nearestIndex = 0;
    let minDistance = Infinity;

    routeMeta.forEach((p, i) => {
        const d = haversine(lat, lng, p.lat, p.lng);
        if (d < minDistance) {
            minDistance = d;
            nearestIndex = i;
        }
    });

    return nearestIndex;
}

function drawRoute() {
    if (routeLine) map.removeLayer(routeLine);
    if (progressLine) map.removeLayer(progressLine);
    if (currentMarker) map.removeLayer(currentMarker);

    checkpointMarkers.forEach(m => map.removeLayer(m));
    checkpointMarkers = [];

    routeLine = L.polyline(fullRouteCoords, {
        color: '#374151',
        weight: 6,
        opacity: 0.9
    }).addTo(map);

    progressLine = L.polyline([fullRouteCoords[0]], {
        color: '#10b981',
        weight: 6,
        opacity: 1
    }).addTo(map);

    checkpoints.forEach(cp => {
        const marker = L.circleMarker([cp.lat, cp.lng], {
            radius: 7,
            color: '#ffffff',
            weight: 2,
            fillColor: '#f59e0b',
            fillOpacity: 1
        }).addTo(map);

        marker.bindPopup(`
            <div class="text-sm">
                <strong>${cp.name}</strong><br>
                Distancia: ${cumulativeDistances[cp.routeIndex].toFixed(1)} km<br>
                Altitud: ${Math.round(cp.ele)} m
            </div>
        `);

        marker.on('click', () => {
            goToRouteIndex(cp.routeIndex);
        });

        checkpointMarkers.push(marker);
    });

    map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });

    const first = routeMeta[0];
    currentMarker = L.circleMarker([first.lat, first.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#10b981',
        fillOpacity: 1
    }).addTo(map);
}

function renderWaypoints() {
    waypointList.innerHTML = '';

    checkpoints.forEach(cp => {
        const distance = cumulativeDistances[cp.routeIndex].toFixed(1);

        const li = document.createElement('li');
        li.className = 'waypoint-card bg-gray-950 border border-gray-800 rounded-lg p-3';
        li.dataset.routeIndex = cp.routeIndex;
        li.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <span class="font-semibold text-white">${cp.name}</span>
                <span class="text-amber-400 text-[11px] font-mono">${distance} km</span>
            </div>
            <div class="mt-1.5 text-xs text-gray-400">
                ${Math.round(cp.ele)} m
            </div>
        `;

        li.addEventListener('click', () => {
            goToRouteIndex(cp.routeIndex);
        });

        waypointList.appendChild(li);
    });
}

function updateWaypointActive(routeIndex) {
    document.querySelectorAll('.waypoint-card').forEach(card => {
        const cardIndex = Number(card.dataset.routeIndex);
        card.classList.toggle('active', cardIndex === routeIndex);
    });
}

function updateStats() {
    statDistance.textContent = totalDistanceKm.toFixed(1);
    statElevation.textContent = Math.round(totalElevationGain);
    distEnd.textContent = `${totalDistanceKm.toFixed(1)} km`;
}

function buildProgressCoords(targetIndex) {
    return fullRouteCoords.slice(0, targetIndex + 1);
}

function updateProgress(routeIndex) {
    const clampedIndex = Math.max(0, Math.min(routeIndex, routeMeta.length - 1));
    const point = routeMeta[clampedIndex];

    progressLine.setLatLngs(buildProgressCoords(clampedIndex));
    currentMarker.setLatLng([point.lat, point.lng]);

    distCurrent.textContent = `${cumulativeDistances[clampedIndex].toFixed(1)} km`;
    currentPointName.textContent = findClosestCheckpointName(clampedIndex) || point.name;
    currentElevation.textContent = `${Math.round(point.ele)} m`;
    currentLat.textContent = point.lat.toFixed(5);
    currentLng.textContent = point.lng.toFixed(5);

    map.panTo([point.lat, point.lng], { animate: true });

    const progressPercent = (clampedIndex / (routeMeta.length - 1)) * 100;
    courseSlicer.value = progressPercent;

    updateWaypointActive(clampedIndex);
    updateChartMarker(clampedIndex);
}

function findClosestCheckpointName(routeIndex) {
    const exact = checkpoints.find(cp => cp.routeIndex === routeIndex);
    return exact ? exact.name : null;
}

function goToRouteIndex(routeIndex) {
    updateProgress(routeIndex);
}

function createElevationChart() {
    const ctx = document.getElementById('elevationChart').getContext('2d');

    if (elevationChart) {
        elevationChart.destroy();
    }

    elevationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: cumulativeDistances.map(d => d.toFixed(1)),
            datasets: [
                {
                    label: 'Elevación (m)',
                    data: routeMeta.map(p => p.ele),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.18)',
                    fill: true,
                    tension: 0.25,
                    pointRadius: 0,
                    borderWidth: 2
                },
                {
                    label: 'Posición actual',
                    data: routeMeta.map(() => null),
                    borderColor: '#f59e0b',
                    backgroundColor: '#f59e0b',
                    pointRadius: 5,
                    pointHoverRadius: 5,
                    showLine: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false
                }
            },

            scales: {
                x: {
                    ticks: {
                        color: '#ffffff'   // 👈 color texto eje X
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'   // opcional grid sutil
                    }
                },
                y: {
                    ticks: {
                        color: '#ffffff'   // 👈 color texto eje Y
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

function updateChartMarker(routeIndex) {
    const markerData = routeMeta.map(() => null);
    markerData[routeIndex] = routeMeta[routeIndex].ele;
    elevationChart.data.datasets[1].data = markerData;
    elevationChart.update('none');
}

function findNearestIndexByPercent(percent) {
    const maxIndex = routeMeta.length - 1;
    return Math.round((percent / 100) * maxIndex);
}

courseSlicer.addEventListener('input', (e) => {
    const percent = Number(e.target.value);
    const routeIndex = findNearestIndexByPercent(percent);
    updateProgress(routeIndex);
});

function convertGeoJSONToGPX() {
    const routeName = 'Andes Ultra 50K';
    const trkpts = routeMeta.map(p => {
        return `<trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.ele}</ele></trkpt>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Pro Trail Dashboard" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${routeName}</name>
  </metadata>
  <trk>
    <name>${routeName}</name>
    <trkseg>
      ${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

exportGpxBtn.addEventListener('click', () => {
    const gpx = convertGeoJSONToGPX();
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'andaluz_2026_50k.gpx';
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
});

async function loadGeoJSON() {
    try {
        const response = await fetch('race.geojson');

        if (!response.ok) {
            throw new Error('No se encontró race.geojson');
        }

        const geojson = await response.json();
        buildRouteData(geojson);
        dataSourceLabel.textContent = '';
    } catch (error) {
        console.warn('Error al cargar o procesar race.geojson. Se usará un ejemplo por defecto.', error);
        buildRouteData(fallbackGeoJSON);
        dataSourceLabel.textContent = 'Fuente de datos: ejemplo interno por error al procesar race.geojson';
    }

    updateStats();
    drawRoute();
    renderWaypoints();
    createElevationChart();
    updateProgress(0);
}

loadGeoJSON();
function updateMapThemeButton() {
    mapThemeLabel.textContent = isSatelliteView ? 'Mapa base' : 'Satélite';
    mapThemeDot.className = `w-2 h-2 rounded-full ${isSatelliteView ? 'bg-emerald-400' : 'bg-gray-400'}`;
}

function toggleMapTheme() {
    if (isSatelliteView) {
        map.removeLayer(satelliteLayer);
        streetsLayer.addTo(map);
    } else {
        map.removeLayer(streetsLayer);
        satelliteLayer.addTo(map);
    }

    isSatelliteView = !isSatelliteView;
    updateMapThemeButton();
}

function setupMobileCollapsibles() {
    document.querySelectorAll('.mobile-collapsible').forEach((card, index) => {
        if (window.innerWidth < 768) {
            card.classList.add('is-collapsed');
            if (index === 0) card.classList.remove('is-collapsed');
        } else {
            card.classList.remove('is-collapsed');
        }
    });

    document.querySelectorAll('.collapsible-trigger').forEach(trigger => {
        trigger.addEventListener('click', () => {
            if (window.innerWidth >= 768) return;
            const card = trigger.closest('.mobile-collapsible');
            card.classList.toggle('is-collapsed');
        });
    });
}

function syncResponsiveState() {
    document.querySelectorAll('.mobile-collapsible').forEach(card => {
        if (window.innerWidth >= 768) {
            card.classList.remove('is-collapsed');
        }
    });
}

function setupHeaderLogo() {
    headerLogo.addEventListener('load', () => {
        logoWrapper.classList.remove('hidden');
    });

    headerLogo.addEventListener('error', () => {
        logoWrapper.classList.add('hidden');
    });
}

mapThemeToggle.addEventListener('click', toggleMapTheme);
window.addEventListener('resize', syncResponsiveState);
setupMobileCollapsibles();
setupHeaderLogo();
updateMapThemeButton();

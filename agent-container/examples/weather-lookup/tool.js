#!/usr/bin/env node
/**
 * Weather Lookup Skill — Example Layer 2 skill for OpenClaw Enterprise Platform.
 * Uses wttr.in free API (no API key required).
 *
 * Usage by OpenClaw: automatically invoked when user asks about weather.
 */

const https = require('https');

function fetchWeather(city) {
  return new Promise((resolve, reject) => {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const current = json.current_condition?.[0] || {};
          resolve({
            city: city,
            temp_c: current.temp_C,
            temp_f: current.temp_F,
            condition: current.weatherDesc?.[0]?.value || 'Unknown',
            humidity: current.humidity,
            wind_kmph: current.windspeedKmph,
            feels_like_c: current.FeelsLikeC,
          });
        } catch (e) {
          reject(new Error(`Failed to parse weather data: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const city = process.argv[2] || 'Seattle';
  try {
    const weather = await fetchWeather(city);
    console.log(JSON.stringify(weather, null, 2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

main();

import type {Point, WeatherSignal} from '../domain/models';

export interface WeatherProvider {
  current(point: Point): Promise<WeatherSignal | null>;
}

export class DisabledWeatherProvider implements WeatherProvider {
  async current() { return null; }
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  async current(point: Point): Promise<WeatherSignal | null> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(point.lat));
    url.searchParams.set('longitude', String(point.lng));
    url.searchParams.set('hourly', 'precipitation');
    url.searchParams.set('forecast_days', '2');
    const response = await fetch(url, {signal: AbortSignal.timeout(5000)});
    if (!response.ok) return null;
    const data = await response.json();
    const precipitation = (data.hourly?.precipitation ?? []).slice(0, 24).reduce((sum: number, value: number) => sum + Number(value || 0), 0);
    return {
      suitability: precipitation < 0.5 ? 'good' : precipitation > 5 ? 'poor' : 'neutral',
      precipitationNext24hMm: Math.round(precipitation * 10) / 10,
      message: precipitation < 0.5 ? 'Good wash window — little precipitation expected for 24h.' : precipitation > 5 ? 'Rain or snow may be expected soon.' : null,
      fetchedAt: new Date().toISOString(),
    };
  }
}

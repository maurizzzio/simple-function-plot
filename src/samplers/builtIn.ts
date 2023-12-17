import utils from '../utils'
import { builtIn as evaluate } from '../helpers/eval'

import { FunctionPlotDatum, FunctionPlotScale } from '../types'
import { SamplerParams, SamplerFn } from './types'

type Asymptote = {
  asymptote: boolean
  d0: [number, number]
  d1: [number, number]
}

type SamplerResultSingle = [number, number]
type SamplerResultGroup = Array<SamplerResultSingle>
type SamplerResult = Array<SamplerResultGroup>

function checkAsymptote(
  d0: [number, number],
  d1: [number, number],
  d: FunctionPlotDatum,
  sign: number,
  level: number
): Asymptote {
  if (!level) {
    return { asymptote: true, d0, d1 }
  }
  const n = 10
  const x0 = d0[0]
  const x1 = d1[0]
  const samples = utils.linspace(x0, x1, n)
  let oldY, oldX
  for (let i = 0; i < n; i += 1) {
    const x = samples[i]
    const y = evaluate(d, 'fn', { x })

    if (oldY) {
      const deltaY = y - oldY
      const newSign = utils.sgn(deltaY)
      if (newSign === sign) {
        return checkAsymptote([oldX, oldY], [x, y], d, sign, level - 1)
      }
    }
    oldY = y
    oldX = x
  }
  return { asymptote: false, d0, d1 }
}

/**
 * Splits the evaluated data into arrays, each array is separated by any asymptote found
 * through the process of detecting slope/sign brusque changes
 */
function split(d: FunctionPlotDatum, data: SamplerResultGroup, yScale: FunctionPlotScale): SamplerResult {
  let oldSign
  const samplerResult: SamplerResult = []
  const yMin = yScale.domain()[0] - utils.infinity()
  const yMax = yScale.domain()[1] + utils.infinity()

  let samplerGroup: SamplerResultGroup = [data[0]]

  let i = 1
  let deltaX = utils.infinity()
  while (i < data.length) {
    const yOld = data[i - 1][1]
    const yNew = data[i][1]
    const deltaY = yNew - yOld
    const newSign = utils.sgn(deltaY)
    // make a new set if:
    if (
      // we have at least 2 entries (so that we can compute deltaY)
      samplerGroup.length >= 2 &&
      // utils.sgn(y1) * utils.sgn(y0) < 0 && // there's a change in the evaluated values sign
      // there's a change in the slope sign
      oldSign !== newSign &&
      // the slope is bigger to some value (according to the current zoom scale)
      Math.abs(deltaY / deltaX) > 1
    ) {
      // retest this section again and determine if it's an asymptote
      const check = checkAsymptote(data[i - 1], data[i], d, newSign, 3)
      if (check.asymptote) {
        // data[i-1] has an updated [x,y], it was already added to a group (in a previous iteration)
        // we just need to update the yCoordinate
        data[i - 1][0] = check.d0[0]
        data[i - 1][1] = utils.clamp(check.d0[1], yMin, yMax)
        samplerResult.push(samplerGroup)

        // data[i] has an updated [x,y], create a new group with it.
        data[i][0] = check.d1[0]
        data[i][1] = utils.clamp(check.d1[1], yMin, yMax)
        samplerGroup = [data[i]]
      } else {
        // false alarm, it's not an asymptote
        samplerGroup.push(data[i])
      }
    } else {
      samplerGroup.push(data[i])
    }

    // wait for at least 2 entries in the group before computing deltaX.
    if (samplerGroup.length > 1) {
      deltaX = samplerGroup[samplerGroup.length - 1][0] - samplerGroup[samplerGroup.length - 2][0]
      oldSign = newSign
    }
    ++i
  }

  if (samplerGroup.length) {
    samplerResult.push(samplerGroup)
  }

  return samplerResult
}

function linear(samplerParams: SamplerParams): SamplerResult {
  const allX = utils.space(samplerParams.xAxis, samplerParams.range, samplerParams.nSamples)
  const yDomain = samplerParams.yScale.domain()
  // const yDomainMargin = yDomain[1] - yDomain[0]
  const yMin = yDomain[0] - utils.infinity()
  const yMax = yDomain[1] + utils.infinity()
  const data: Array<[number, number]> = []
  for (let i = 0; i < allX.length; i += 1) {
    const x = allX[i]
    let y = evaluate(samplerParams.d, 'fn', { x })
    if (utils.isValidNumber(x) && utils.isValidNumber(y)) {
      y = utils.clamp(y, yMin, yMax)
      data.push([x, y])
    }
  }
  const splitData = split(samplerParams.d, data, samplerParams.yScale)
  return splitData
}

function parametric(samplerParams: SamplerParams): SamplerResult {
  // range is mapped to canvas coordinates from the input
  // for parametric plots the range will tell the start/end points of the `t` param
  const parametricRange = samplerParams.d.range || [0, 2 * Math.PI]
  const tCoords = utils.space(samplerParams.xAxis, parametricRange, samplerParams.nSamples)
  const samples: SamplerResultGroup = []
  for (let i = 0; i < tCoords.length; i += 1) {
    const t = tCoords[i]
    const x = evaluate(samplerParams.d, 'x', { t })
    const y = evaluate(samplerParams.d, 'y', { t })
    samples.push([x, y])
  }
  return [samples]
}

function polar(samplerParams: SamplerParams): SamplerResult {
  // range is mapped to canvas coordinates from the input
  // for polar plots the range will tell the start/end points of the `theta` param
  const polarRange = samplerParams.d.range || [-Math.PI, Math.PI]
  const thetaSamples = utils.space(samplerParams.xAxis, polarRange, samplerParams.nSamples)
  const samples: SamplerResultGroup = []
  for (let i = 0; i < thetaSamples.length; i += 1) {
    const theta = thetaSamples[i]
    const r = evaluate(samplerParams.d, 'r', { theta })
    const x = r * Math.cos(theta)
    const y = r * Math.sin(theta)
    samples.push([x, y])
  }
  return [samples]
}

function points(samplerParams: SamplerParams): SamplerResult {
  return [samplerParams.d.points]
}

function vector(sampleParams: SamplerParams): SamplerResult {
  const d = sampleParams.d
  d.offset = d.offset || [0, 0]
  return [[d.offset, [d.vector[0] + d.offset[0], d.vector[1] + d.offset[1]]]]
}

const sampler: SamplerFn = function sampler(samplerParams: SamplerParams): SamplerResult {
  switch (samplerParams.d.fnType) {
    case 'linear':
      return linear(samplerParams)
    case 'parametric':
      return parametric(samplerParams)
    case 'polar':
      return polar(samplerParams)
    case 'vector':
      return vector(samplerParams)
    case 'points':
      return points(samplerParams)
    default:
      throw Error(samplerParams.d.fnType + ' is not supported in the `builtIn` sampler')
  }
}

export default sampler

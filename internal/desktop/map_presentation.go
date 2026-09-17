package desktop

import (
	"strconv"

	"github.com/freebeamer/core/pkg/types"
)

func axisDetail(axis types.MapAxis) types.AxisDetail {
	bits := 0
	if axis.Layout != nil {
		bits = dataTypeBits(axis.Layout.DataType)
	}
	return types.AxisDetail{
		Units:       axis.Unit,
		Formula:     axis.Conversion.Expression,
		Addressed:   axis.Layout != nil && axis.Layout.Address != nil,
		ElementBits: bits,
	}
}

func parameterDetail(parameter types.MapParameter) types.AxisDetail {
	return types.AxisDetail{
		Units:       parameter.Unit,
		Formula:     parameter.Conversion.Expression,
		Addressed:   parameter.Layout.Address != nil,
		ElementBits: dataTypeBits(parameter.Layout.DataType),
	}
}

func dataTypeBits(dataType string) int {
	switch dataType {
	case "uint8", "int8":
		return 8
	case "uint16", "int16":
		return 16
	case "uint32", "int32":
		return 32
	default:
		return 0
	}
}

func declaredShape(parameter types.MapParameter) types.MapShape {
	if len(parameter.Layout.Dimensions) == 1 {
		return shapeForDimensions(1, parameter.Layout.Dimensions[0])
	}
	if len(parameter.Layout.Dimensions) == 2 {
		return shapeForDimensions(parameter.Layout.Dimensions[0], parameter.Layout.Dimensions[1])
	}
	return types.ShapeInvalid
}

func classifyShape(decoded *types.DecodedTable) types.MapShape {
	rows := len(decoded.Z)
	columns := 0
	if rows > 0 {
		columns = len(decoded.Z[0])
	}
	return shapeForDimensions(rows, columns)
}

func shapeForDimensions(rows, columns int) types.MapShape {
	switch {
	case rows > 1 && columns > 1:
		return types.ShapeMatrix
	case rows > 1 || columns > 1:
		return types.ShapeOneAxis
	default:
		return types.ShapeScalar
	}
}

func hexAddresses(addresses []uint64) []string {
	if addresses == nil {
		return nil
	}
	result := make([]string, len(addresses))
	for index, address := range addresses {
		result[index] = hexAddress(address)
	}
	return result
}

func hexAddressRows(rows [][]uint64) [][]string {
	if rows == nil {
		return nil
	}
	result := make([][]string, len(rows))
	for index, row := range rows {
		result[index] = hexAddresses(row)
	}
	return result
}

func hexAddress(address uint64) string {
	return "0x" + strconv.FormatUint(address, 16)
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
